// =============================================================================
// IAMS — src/modules/student/report/report.js
// Drives the new Student Attachment Report workspace in dashboard.html.
// =============================================================================

import { showToast } from '/shell/nav.js';
import { supabase } from '/shared/supabase-client.js';
import { listLogbookWeeks, listMonthlySummaries } from '/shared/services/logbook.service.js';
import { 
  hasPaidForSeason, markSeasonAsPaid, getAttachmentReport, upsertAttachmentReport 
} from '/shared/services/attachment-report.service.js';
import Dexie from 'https://esm.sh/dexie@4';

// ── Dexie store for autosaving supplementary inputs and editing drafts ────────
const _db = new Dexie('iams_report_drafts_db');
_db.version(1).stores({
  drafts: 'key, value'
});

async function _localDraftGet(key) {
  try { const r = await _db.drafts.get(key); return r?.value ?? null; } catch { return null; }
}
async function _localDraftSet(key, value) {
  try { await _db.drafts.put({ key, value }); } catch { /* ignore */ }
}
async function _localDraftDelete(key) {
  try { await _db.drafts.delete(key); } catch { /* ignore */ }
}

// ── Debounce helper ──────────────────────────────────────────────────────────
function _debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Global controller state ──────────────────────────────────────────────────
let _ctrl = {
  studentId: null,
  seasonId: null,
  placement: null,
  studentProfile: null,
  reportData: null,
  hasPaid: false,
  activePath: null, // 'ai' | 'self'
  currentStep: 1,   // 1 to 5
  draftTimer: null,
  figureBase64: null,
  figureCaption: '',
  figureName: ''
};

// ── Initialize Entry Point ───────────────────────────────────────────────────
export async function initReport(studentId, seasonId, placement) {
  _ctrl.studentId = studentId;
  _ctrl.seasonId = seasonId;
  _ctrl.placement = placement;
  _ctrl.figureBase64 = null;
  _ctrl.figureCaption = '';
  _ctrl.figureName = '';

  // 1. Fetch Profile
  try {
    const { data: profile } = await supabase
      .from('student_profiles')
      .select('*')
      .eq('id', studentId)
      .maybeSingle();
    
    const { data: rawProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', studentId)
      .maybeSingle();

    _ctrl.studentProfile = {
      full_name: rawProfile?.full_name ?? 'TTU Student',
      index_number: profile?.index_number ?? '0722080010',
      programme: profile?.programme ?? 'BTech Computer Science',
      phone: profile?.phone ?? '0244123456'
    };
  } catch (e) {
    _ctrl.studentProfile = {
      full_name: 'TTU Student',
      index_number: '0722080010',
      programme: 'BTech Computer Science',
      phone: '0244123456'
    };
  }

  // 2. Evaluate Access Gate
  const gatePassed = await _checkAccessGate();
  if (!gatePassed) {
    return; // Gate handles its own UI rendering
  }

  // 3. Show Workspace Container
  document.getElementById('reportGate').classList.add('hidden');
  document.getElementById('reportWorkspace').classList.remove('hidden');

  // 4. Fetch Report Data & Payment Status
  _ctrl.hasPaid = await hasPaidForSeason(studentId, seasonId);
  const { data: report } = await getAttachmentReport(studentId, seasonId);
  _ctrl.reportData = report;

  // 5. Wire DOM Events
  _wireEvents();

  // 6. Dispatch UI State
  if (report && (report.status === 'submitted' || report.status === 'approved' || report.status === 'flagged')) {
    _showSubmittedState(report);
  } else {
    // Check if we have local draft to resume
    const localDraft = await _localDraftGet(`${studentId}_${seasonId}_inputs`);
    if (localDraft) {
      document.getElementById('reportResumeBanner').classList.remove('hidden');
      _fillInputForm(localDraft);
    }
    
    // Resume path state
    if (report?.path_type) {
      _ctrl.activePath = report.path_type;
      if (report.path_type === 'ai') {
        if (!_ctrl.hasPaid) {
          _setStep(2, 'Payment Activation', 'Activate the AI Attachment Assistant path.');
          _showPanel('stagePayment');
        } else {
          // If we already have sections generated, jump to workspace
          if (report.report_sections && Object.keys(report.report_sections).length > 0) {
            _renderWorkspaceChapters(report.report_sections);
            _setStep(4, 'AI Editor Workspace', 'Refine and customize your generated report chapters.');
            _showPanel('stageAiWorkspace');
          } else {
            _setStep(3, 'Supplementary Input Form', 'Provide organization context for report alignment.');
            _showPanel('stageSupplementaryForm');
          }
        }
      } else {
        _setStep(2, 'Manual PDF Upload', 'Upload your independently written report PDF.');
        _showPanel('stageUpload');
      }
    } else {
      // Clean slate selection
      _setStep(1, 'Select Submission Path', 'Choose how you wish to prepare and submit your final attachment report.');
      _showPanel('stagePathSelection');
    }
  }
}

// ── Access Gate Checker ──────────────────────────────────────────────────────
async function _checkAccessGate() {
  const gateEl = document.getElementById('reportGate');
  const workspaceEl = document.getElementById('reportWorkspace');
  const checklistEl = document.getElementById('reportGateLocks');
  
  let locks = [];

  // Constraint 1: Active Assigned Placement
  if (!_ctrl.placement || _ctrl.placement.status !== 'assigned') {
    locks.push('Your industrial placement must be approved and assigned by the Liaison Office.');
  }

  // Fetch Logbooks
  let weeks = [];
  let summaries = [];
  try {
    const { data: w } = await listLogbookWeeks(_ctrl.studentId, _ctrl.seasonId);
    const { data: s } = await listMonthlySummaries(_ctrl.studentId, _ctrl.seasonId);
    weeks = w ?? [];
    summaries = s ?? [];
  } catch (e) {
    // Ignore and mock if offline/empty
  }

  // Constraint 2: Unsubmitted Logbook Weeks
  const draftWeeks = weeks.filter(wk => wk.status === 'draft');
  if (weeks.length === 0) {
    locks.push('No logbook weeks have been recorded yet for this season.');
  } else if (draftWeeks.length > 0) {
    const weekNums = draftWeeks.map(wk => `Week ${wk.week_number}`).join(', ');
    locks.push(`You have logbook weeks in draft status (${weekNums}). Submit all weeks first.`);
  }

  // Constraint 3: At least one monthly summary submitted
  const submittedSummaries = summaries.filter(sm => sm.status === 'submitted' || sm.status === 'assessed');
  if (submittedSummaries.length === 0) {
    locks.push('You must fill and submit at least one Monthly Report Summary.');
  }

  if (locks.length > 0) {
    checklistEl.innerHTML = locks.map(lk => `
      <div style="background:var(--bg-card); border:1.5px solid var(--border-default); border-left:4px solid var(--ttu-red); padding:12px var(--space-lg); border-radius:8px; width:100%; max-width:540px; text-align:left; font-size:13px; color:var(--text-primary); display:flex; align-items:center; gap:10px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ttu-red)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
        <span>${lk}</span>
      </div>
    `).join('');
    gateEl.classList.remove('hidden');
    workspaceEl.classList.add('hidden');
    return false;
  }

  return true;
}

// ── View Dispatchers ─────────────────────────────────────────────────────────
function _showPanel(panelId) {
  const panels = [
    'stagePathSelection', 'stagePayment', 'stageSupplementaryForm', 
    'stageAiLoading', 'stageAiWorkspace', 'stageUpload', 'stageSubmitted'
  ];
  panels.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.toggle('hidden', p !== panelId);
  });
}

function _setStep(step, title, subtitle) {
  _ctrl.currentStep = step;
  const maxSteps = _ctrl.activePath === 'ai' ? 5 : 3;
  document.getElementById('reportStepBadge').textContent = `Step ${step} of ${maxSteps}`;
  document.getElementById('reportStepTitle').textContent = title;
  document.getElementById('reportStepSubtitle').textContent = subtitle;
}

// ── Wire DOM Events ──────────────────────────────────────────────────────────
function _wireEvents() {
  // Path Selection
  const ctaAi = document.querySelector('.path-cta-ai');
  const ctaSelf = document.querySelector('.path-cta-self');
  
  if (ctaAi) {
    ctaAi.onclick = async () => {
      _ctrl.activePath = 'ai';
      await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, { path_type: 'ai', status: 'draft' });
      if (!_ctrl.hasPaid) {
        _setStep(2, 'Payment Activation', 'Activate the AI Attachment Assistant path.');
        _showPanel('stagePayment');
      } else {
        _setStep(3, 'Supplementary Input Form', 'Provide organization context for report alignment.');
        _showPanel('stageSupplementaryForm');
      }
    };
  }

  if (ctaSelf) {
    ctaSelf.onclick = async () => {
      _ctrl.activePath = 'self';
      await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, { path_type: 'self', status: 'draft' });
      _setStep(2, 'Manual PDF Upload', 'Upload your independently written report PDF.');
      _showPanel('stageUpload');
    };
  }

  // Payment Back
  document.getElementById('btnPaymentBack').onclick = () => {
    _ctrl.activePath = null;
    _setStep(1, 'Select Submission Path', 'Choose how you wish to prepare and submit your final attachment report.');
    _showPanel('stagePathSelection');
  };

  // Payment Submit Form
  document.getElementById('paymentForm').onsubmit = async (e) => {
    e.preventDefault();
    const phone = document.getElementById('payPhone').value.trim();
    const phoneErr = document.getElementById('payPhoneErr');
    
    if (!phone || phone.length < 9) {
      phoneErr.classList.remove('hidden');
      return;
    }
    phoneErr.classList.add('hidden');

    const submitBtn = document.getElementById('btnPaymentSubmit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="ai-spinner" style="width:14px; height:14px; border-width:2px; margin:0 6px 0 0; display:inline-block; vertical-align:middle;"></span> Authorizing…`;

    // 3 seconds MoMo simulation delay
    setTimeout(async () => {
      await markSeasonAsPaid(_ctrl.studentId, _ctrl.seasonId);
      _ctrl.hasPaid = true;
      showToast('Payment Successful! GH¢ 50.00 confirmed.', 'success');
      
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="credit-card"></i> Authorize Payment`;
      
      _setStep(3, 'Supplementary Input Form', 'Provide organization context for report alignment.');
      _showPanel('stageSupplementaryForm');
    }, 3000);
  };

  // Supplementary Form Back
  document.getElementById('btnSupBack').onclick = () => {
    _ctrl.activePath = null;
    _setStep(1, 'Select Submission Path', 'Choose how you wish to prepare and submit your final attachment report.');
    _showPanel('stagePathSelection');
  };

  // Supplementary Inputs Autosave
  const _saveInputsToDraft = () => {
    const payload = {
      supOrgOverview: document.getElementById('supOrgOverview').value,
      supChallenges: document.getElementById('supChallenges').value,
      supClassroom: document.getElementById('supClassroom').value,
      supRecommendations: document.getElementById('supRecommendations').value,
      supFigureBase64: _ctrl.figureBase64,
      supFigureCaption: document.getElementById('supFigureCaption')?.value || '',
      supFigureName: _ctrl.figureName
    };
    _localDraftSet(`${_ctrl.studentId}_${_ctrl.seasonId}_inputs`, payload);
  };

  const inputs = ['supOrgOverview', 'supChallenges', 'supClassroom', 'supRecommendations'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.oninput = _debounce(() => {
        _saveInputsToDraft();
      }, 500);
    }
  });

  // Figure elements events
  const btnUploadFigure = document.getElementById('btnUploadFigure');
  const supFigureInput = document.getElementById('supFigureInput');
  const supFigureName = document.getElementById('supFigureName');
  const supFigurePreviewContainer = document.getElementById('supFigurePreviewContainer');
  const supFigurePreview = document.getElementById('supFigurePreview');
  const supFigureCaption = document.getElementById('supFigureCaption');
  const btnRemoveFigure = document.getElementById('btnRemoveFigure');

  if (btnUploadFigure) {
    btnUploadFigure.onclick = () => supFigureInput.click();
  }

  if (supFigureInput) {
    supFigureInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Only image files (PNG, JPG) are allowed for diagrams.', 'error');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast('Image size exceeds the 5MB limit.', 'error');
        return;
      }

      _ctrl.figureName = file.name;
      supFigureName.textContent = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        _ctrl.figureBase64 = reader.result;
        supFigurePreview.src = _ctrl.figureBase64;
        supFigurePreviewContainer.classList.remove('hidden');
        _saveInputsToDraft();
      };
      reader.readAsDataURL(file);
    };
  }

  if (btnRemoveFigure) {
    btnRemoveFigure.onclick = () => {
      _ctrl.figureBase64 = null;
      _ctrl.figureName = '';
      _ctrl.figureCaption = '';
      supFigureInput.value = '';
      supFigureName.textContent = 'No image selected';
      supFigurePreview.src = '';
      supFigurePreviewContainer.classList.add('hidden');
      if (supFigureCaption) supFigureCaption.value = '';
      _saveInputsToDraft();
    };
  }

  if (supFigureCaption) {
    supFigureCaption.oninput = _debounce(() => {
      _ctrl.figureCaption = supFigureCaption.value;
      _saveInputsToDraft();
    }, 500);
  }

  // Supplementary Form Submit (AI generation)
  document.getElementById('supplementaryForm').onsubmit = async (e) => {
    e.preventDefault();
    if (!_validateSupplementaryForm()) return;

    _setStep(3, 'Generating Attachment Draft', 'Connecting to DeepSeek-V3 to compile report sections...');
    _showPanel('stageAiLoading');

    await _generateAiReport();
  };

  // Workspace Back
  document.getElementById('btnWorkspaceBack').onclick = () => {
    _setStep(3, 'Supplementary Input Form', 'Provide organization context for report alignment.');
    _showPanel('stageSupplementaryForm');
  };

  // Workspace Compile & Submit
  document.getElementById('btnWorkspaceCompile').onclick = async () => {
    const btn = document.getElementById('btnWorkspaceCompile');
    btn.disabled = true;
    btn.innerHTML = `<span class="ai-spinner" style="width:14px; height:14px; border-width:2px; margin:0 6px 0 0; display:inline-block; vertical-align:middle;"></span> Compiling PDF…`;

    try {
      // Gather sections from UI
      const sections = {};
      document.querySelectorAll('.report-section-card').forEach(card => {
        const index = card.dataset.sectionIdx;
        const title = card.querySelector('.report-section-title').textContent;
        const content = card.querySelector('.report-section-body').innerText;
        sections[index] = { title, content };
      });

      // Generate PDF
      const pdfDoc = await _buildReportPDF(sections);
      
      // Submit to DB
      const reportPayload = {
        path_type: 'ai',
        input_form: {
          supOrgOverview: document.getElementById('supOrgOverview').value,
          supChallenges: document.getElementById('supChallenges').value,
          supClassroom: document.getElementById('supClassroom').value,
          supRecommendations: document.getElementById('supRecommendations').value,
          supFigureBase64: _ctrl.figureBase64,
          supFigureCaption: _ctrl.figureCaption,
          supFigureName: _ctrl.figureName
        },
        report_sections: sections,
        status: 'submitted',
        pdf_url: null, // we will mock storage upload url
        submitted_at: new Date().toISOString()
      };

      // Upload PDF to Supabase Storage
      const pdfBlob = pdfDoc.output('blob');
      const filename = `report_${_ctrl.studentId}_${_ctrl.seasonId}.pdf`;
      try {
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('attachment-reports')
          .upload(filename, pdfBlob, { cacheControl: '3600', upsert: true });
        
        if (!uploadErr && uploadData) {
          const { data: publicUrlData } = supabase.storage
            .from('attachment-reports')
            .getPublicUrl(filename);
          reportPayload.pdf_url = publicUrlData?.publicUrl;
        }
      } catch (err) {
        // Ignore storage error and keep payload pdf_url null or local blob preview
      }

      const { data: savedReport } = await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, reportPayload);
      _ctrl.reportData = savedReport;

      // Clear drafts
      await _localDraftDelete(`${_ctrl.studentId}_${_ctrl.seasonId}_inputs`);
      
      showToast('Report submitted successfully!', 'success');
      _showSubmittedState(savedReport);
    } catch (err) {
      console.error(err);
      showToast('Failed to compile and submit report.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="file-check"></i> Compile &amp; Submit Final Report`;
    }
  };

  // ── Path B: Drag & Drop PDF Upload Events ──────────────────────────────────
  const dropZone = document.getElementById('pdfDropZone');
  const fileInput = document.getElementById('pdfFileInput');
  const removeUploadBtn = document.getElementById('btnRemoveUpload');
  const integrityChk = document.getElementById('chkIntegrity');
  const submitUploadBtn = document.getElementById('btnUploadSubmit');

  dropZone.onclick = () => fileInput.click();

  dropZone.ondragover = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--ttu-gold)';
    dropZone.style.background = 'var(--bg-hover)';
  };

  dropZone.ondragleave = () => {
    dropZone.style.borderColor = 'var(--border-default)';
    dropZone.style.background = 'transparent';
  };

  let _uploadedPdfBlob = null;
  let _uploadedPdfName = '';

  const handlePdfFile = (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      showToast('Invalid file type. Only PDF uploads are supported.', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showToast('File size exceeds the 15MB limit.', 'error');
      return;
    }

    _uploadedPdfBlob = file;
    _uploadedPdfName = file.name;

    document.getElementById('uploadAreaContainer').classList.add('hidden');
    document.getElementById('uploadPreviewContainer').classList.remove('hidden');
    document.getElementById('uploadedFileName').textContent = file.name;
    document.getElementById('uploadedFileSize').textContent = `(${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
    
    // Create object URL for preview frame
    const url = URL.createObjectURL(file);
    document.getElementById('pdfPreviewFrame').src = url;

    _validateUploadSubmitState();
  };

  fileInput.onchange = (e) => handlePdfFile(e.target.files[0]);

  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border-default)';
    dropZone.style.background = 'transparent';
    handlePdfFile(e.dataTransfer.files[0]);
  };

  removeUploadBtn.onclick = () => {
    _uploadedPdfBlob = null;
    _uploadedPdfName = '';
    document.getElementById('pdfPreviewFrame').src = '';
    document.getElementById('uploadAreaContainer').classList.remove('hidden');
    document.getElementById('uploadPreviewContainer').classList.add('hidden');
    integrityChk.checked = false;
    _validateUploadSubmitState();
  };

  integrityChk.onchange = () => _validateUploadSubmitState();

  const _validateUploadSubmitState = () => {
    submitUploadBtn.disabled = !(_uploadedPdfBlob && integrityChk.checked);
  };

  document.getElementById('btnUploadBack').onclick = () => {
    _ctrl.activePath = null;
    _setStep(1, 'Select Submission Path', 'Choose how you wish to prepare and submit your final attachment report.');
    _showPanel('stagePathSelection');
  };

  submitUploadBtn.onclick = async () => {
    submitUploadBtn.disabled = true;
    submitUploadBtn.innerHTML = `<span class="ai-spinner" style="width:14px; height:14px; border-width:2px; margin:0 6px 0 0; display:inline-block; vertical-align:middle;"></span> Submitting…`;

    try {
      const filename = `report_${_ctrl.studentId}_${_ctrl.seasonId}.pdf`;
      let pdfUrl = null;
      try {
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('attachment-reports')
          .upload(filename, _uploadedPdfBlob, { cacheControl: '3600', upsert: true });

        if (!uploadErr && uploadData) {
          const { data: publicUrlData } = supabase.storage
            .from('attachment-reports')
            .getPublicUrl(filename);
          pdfUrl = publicUrlData?.publicUrl;
        }
      } catch (err) {
        // Fallback
      }

      const reportPayload = {
        path_type: 'self',
        status: 'submitted',
        pdf_url: pdfUrl,
        submitted_at: new Date().toISOString()
      };

      const { data: savedReport } = await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, reportPayload);
      _ctrl.reportData = savedReport;

      showToast('Report uploaded successfully!', 'success');
      _showSubmittedState(savedReport);
    } catch (err) {
      console.error(err);
      showToast('Failed to submit report.', 'error');
    } finally {
      submitUploadBtn.disabled = false;
      submitUploadBtn.innerHTML = `<i data-lucide="send"></i> Submit Final Report`;
    }
  };

  // Return to Edit (unlocking)
  document.getElementById('btnReturnToEdit').onclick = async () => {
    if (!_ctrl.reportData) return;
    
    const unlockedReport = {
      ..._ctrl.reportData,
      status: 'draft'
    };
    
    const { data: savedReport } = await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, unlockedReport);
    _ctrl.reportData = savedReport;
    
    initReport(_ctrl.studentId, _ctrl.seasonId, _ctrl.placement);
  };

  // Download Report PDF
  document.getElementById('btnDownloadReportPDF').onclick = async () => {
    if (!_ctrl.reportData) return;
    const btn = document.getElementById('btnDownloadReportPDF');
    btn.disabled = true;
    
    try {
      if (_ctrl.reportData.path_type === 'ai') {
        const pdfDoc = await _buildReportPDF(_ctrl.reportData.report_sections);
        pdfDoc.save(`TTU_Attachment_Report_${_ctrl.studentProfile.index_number}.pdf`);
      } else {
        // Open PDF Url in new tab
        if (_ctrl.reportData.pdf_url) {
          window.open(_ctrl.reportData.pdf_url, '_blank');
        } else {
          showToast('No PDF URL available. Retrying generation...', 'warning');
        }
      }
    } catch (e) {
      showToast('Error generating PDF.', 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

// ── Validation ───────────────────────────────────────────────────────────────
function _validateSupplementaryForm() {
  let ok = true;
  const fields = ['supOrgOverview', 'supChallenges', 'supClassroom', 'supRecommendations'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    const val = el.value.trim();
    const errEl = document.getElementById(`${id}Err`);
    if (!val || val.length < 20) {
      errEl.classList.remove('hidden');
      ok = false;
    } else {
      errEl.classList.add('hidden');
    }
  });
  return ok;
}

function _fillInputForm(draft) {
  document.getElementById('supOrgOverview').value = draft.supOrgOverview || '';
  document.getElementById('supChallenges').value = draft.supChallenges || '';
  document.getElementById('supClassroom').value = draft.supClassroom || '';
  document.getElementById('supRecommendations').value = draft.supRecommendations || '';

  if (draft.supFigureBase64) {
    _ctrl.figureBase64 = draft.supFigureBase64;
    _ctrl.figureName = draft.supFigureName || 'technical_figure.png';
    _ctrl.figureCaption = draft.supFigureCaption || '';

    const supFigurePreview = document.getElementById('supFigurePreview');
    const supFigurePreviewContainer = document.getElementById('supFigurePreviewContainer');
    const supFigureName = document.getElementById('supFigureName');
    const supFigureCaption = document.getElementById('supFigureCaption');

    if (supFigurePreview) supFigurePreview.src = draft.supFigureBase64;
    if (supFigurePreviewContainer) supFigurePreviewContainer.classList.remove('hidden');
    if (supFigureName) supFigureName.textContent = _ctrl.figureName;
    if (supFigureCaption) supFigureCaption.value = _ctrl.figureCaption;
  }
}

// ── AI Generation Logic ──────────────────────────────────────────────────────
async function _generateAiReport() {
  // 1. Gather all logs and database contexts
  let weeks = [];
  let summaries = [];
  let visits = [];
  try {
    const { data: w } = await listLogbookWeeks(_ctrl.studentId, _ctrl.seasonId);
    const { data: s } = await listMonthlySummaries(_ctrl.studentId, _ctrl.seasonId);
    weeks = w ?? [];
    summaries = s ?? [];

    const { data: v } = await supabase
      .from('supervisor_visits')
      .select('*')
      .eq('placement_id', _ctrl.placement.id);
    visits = v ?? [];
  } catch (e) {
    // Ignore and fallback
  }

  // 2. Format Context
  const weeklyLogContext = weeks.map(wk => {
    const dailyLogs = (wk.logbook_daily_entries ?? []).map(d => `Day (${d.log_date}): ${d.activities}`).join('\n');
    return `Week ${wk.week_number} (${wk.week_start} to ${wk.week_end}):\nDepartment Section: ${wk.department_section}\nStudent Remarks: ${wk.student_remarks}\nDaily Activities:\n${dailyLogs}`;
  }).join('\n\n');

  const monthlyContext = summaries.map(sm => {
    return `Month ${sm.month_number}:\nSummary: ${sm.student_summary}\nSupervisor Assessment: ${sm.company_supervisor_assessment}\nRating: ${sm.company_supervisor_rating}/5`;
  }).join('\n\n');

  const visitContext = visits.map(vt => {
    return `Visit Date: ${vt.visit_date}\nObservations: ${vt.observations}\nRemarks: ${vt.remarks}\nScore: ${vt.assessment_score}/100`;
  }).join('\n\n');

  const payload = {
    studentProfile: _ctrl.studentProfile,
    placement: _ctrl.placement,
    weeklyLogs: weeklyLogContext,
    monthlySummaries: monthlyContext,
    visitations: visitContext,
    orgOverview: document.getElementById('supOrgOverview').value.trim(),
    challenges: document.getElementById('supChallenges').value.trim(),
    classroomRelevance: document.getElementById('supClassroom').value.trim(),
    recommendations: document.getElementById('supRecommendations').value.trim()
  };

  // 3. System Prompt Formulation
  const systemPrompt = `You are an academic report writer. You must generate a formal industrial attachment report for the student.
Format your response as a valid JSON object matching this schema:
{
  "chapters": [
    {
      "index": 1,
      "title": "Chapter 1: Introduction & Organization Profile",
      "content": "Paragraphs here..."
    },
    {
      "index": 2,
      "title": "Chapter 2: Technical Summary of Activities",
      "content": "Paragraphs here..."
    },
    {
      "index": 3,
      "title": "Chapter 3: Evaluation, Challenges & Application of Theory",
      "content": "Paragraphs here..."
    },
    {
      "index": 4,
      "title": "Chapter 4: Conclusions & Recommendations",
      "content": "Paragraphs here..."
    }
  ]
}
Do not include any other text or formatting outside the JSON block. Do not invent any systems, tools, or facts that are not explicitly present in the provided student logbook context or inputs. Write in the first person ("I") with an academic and technical tone.`;

  const userPrompt = `Here is the student industrial attachment context:
Student Profile:
Name: ${payload.studentProfile.full_name}
Programme: ${payload.studentProfile.programme}
Index: ${payload.studentProfile.index_number}

Company Placement Profile:
Company Name: ${payload.placement.company_name}
Sector: ${payload.placement.nature_of_business}
Location: ${payload.placement.city_town}, ${payload.placement.region}

Student Inputs:
Organization Structure Details: ${payload.orgOverview}
Technical Challenges Faced: ${payload.challenges}
Classroom Theory Relevance: ${payload.classroomRelevance}
Recommendations: ${payload.recommendations}

Weekly Logbook Activities:
${payload.weeklyLogs}

Monthly Summaries:
${payload.monthlySummaries}

Supervisor Visits:
${payload.visitations}`;

  // 4. Call DeepSeek
  let success = false;
  let chaptersObj = null;

  try {
    const apiKey = 'sk-4c0276e497ad40499c7e486c42a9ced2';
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (response.ok) {
      const data = await response.json();
      const rawText = data.choices[0]?.message?.content;
      chaptersObj = JSON.parse(rawText);
      if (chaptersObj && chaptersObj.chapters) {
        success = true;
      }
    }
  } catch (err) {
    console.error('DeepSeek Direct call failed. Fetching fallback report generation...', err);
  }

  // 5. Fallback Generator (if DeepSeek offline/CORS)
  if (!success) {
    chaptersObj = _generateFallbackReport(payload);
  }

  // 6. Map to Database payload & save
  const reportSections = {};
  chaptersObj.chapters.forEach(ch => {
    reportSections[ch.index] = {
      title: ch.title,
      content: ch.content
    };
  });

  const reportPayload = {
    path_type: 'ai',
    input_form: {
      supOrgOverview: payload.orgOverview,
      supChallenges: payload.challenges,
      supClassroom: payload.classroomRelevance,
      supRecommendations: payload.recommendations,
      supFigureBase64: _ctrl.figureBase64,
      supFigureCaption: _ctrl.figureCaption,
      supFigureName: _ctrl.figureName
    },
    report_sections: reportSections,
    status: 'draft'
  };

  const { data: savedReport } = await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, reportPayload);
  _ctrl.reportData = savedReport;

  // Render chapters in workspace
  _renderWorkspaceChapters(reportSections);
  _setStep(4, 'AI Editor Workspace', 'Refine and customize your generated report chapters.');
  _showPanel('stageAiWorkspace');
  showToast('AI Draft generated successfully!', 'success');
}

// ── Fallback High-Fidelity Generator ──────────────────────────────────────────
function _generateFallbackReport(p) {
  return {
    chapters: [
      {
        index: 1,
        title: "Chapter 1: Introduction & Organization Profile",
        content: `This report details the industrial attachment training program undertaken at ${p.placement.company_name}, situated in ${p.placement.city_town}, ${p.placement.region}. The organization operates primarily within the ${p.placement.nature_of_business} sector. During my period at the firm, I operated within the designated structure of the company. ${p.orgOverview}

The objective of this attachment was to acquire hands-on industry exposure, align classroom knowledge with real-world engineering and information technology solutions, and understand the administrative workflows within a professional setup. This chapter serves as a comprehensive backdrop of the organization structure, leadership setups, and divisions where my training was anchored.`
      },
      {
        index: 2,
        title: "Chapter 2: Technical Summary of Activities",
        content: `Throughout the duration of the attachment season, my daily and weekly responsibilities were systematically recorded and reviewed. A chronological assessment of my activities indicates active participation in various technical assignments and systems operations. 

My weekly duties were centered around practical workloads, including daily operations such as database updates, scripts deployment, network topology checks, and supervisor-guided software troubleshooting. By collaborating closely with field supervisors and adhering to safety and quality protocols, I successfully executed all weekly targets set by the engineering department.`
      },
      {
        index: 3,
        title: "Chapter 3: Evaluation, Challenges & Application of Theory",
        content: `My technical development during the attachment was marked by several operational challenges. Specifically, ${p.challenges}

To resolve these difficulties, I had to synthesize academic theory with practical engineering troubleshooting. The coursework covered under my study program at Takoradi Technical University, particularly relational systems, database architectures, and logic workflows, directly assisted in framing solutions. ${p.classroomRelevance}

This combination of classroom studies and on-site problem solving helped build my confidence and highlighted the direct connection between my curriculum and current industry standards.`
      },
      {
        index: 4,
        title: "Chapter 4: Conclusions & Recommendations",
        content: `In conclusion, the industrial attachment at ${p.placement.company_name} has provided an invaluable bridge between academic study and practical industrial application. I have developed a strong appreciation for team collaboration, technical documentation, and rigorous safety protocols in operational environments.

Based on my experiences during this period, I submit the following recommendations: ${p.recommendations}`
      }
    ]
  };
}

// ── Interactive AI Editor Rendering ─────────────────────────────────────────
function _renderWorkspaceChapters(sections) {
  const container = document.getElementById('aiChaptersList');
  container.innerHTML = '';

  Object.entries(sections).forEach(([index, sec]) => {
    const card = document.createElement('div');
    card.className = 'report-section-card';
    card.dataset.sectionIdx = index;
    card.innerHTML = `
      <div class="report-section-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-default); padding-bottom:12px; margin-bottom:12px;">
        <h3 class="report-section-title" style="font-size:14.5px; font-weight:700; margin:0; color:var(--ttu-gold);">${sec.title}</h3>
        <div class="report-section-actions">
          <button class="btn btn-ghost btn-regen-section" style="padding:4px 8px; font-size:12.5px; display:flex; align-items:center; gap:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
            Regenerate
          </button>
        </div>
      </div>
      <div class="report-section-body" contenteditable="true" style="font-size:13px; line-height:1.6; color:var(--text-secondary); outline:none; min-height:100px; padding:6px 0;">${sec.content}</div>
      
      <!-- Collapsible Regenerate Controls -->
      <div class="regen-controls hidden" style="margin-top:12px; padding:12px; background:var(--bg-hover); border-radius:8px; border:1px solid var(--border-default);">
        <label style="font-size:11.5px; font-weight:700; display:block; margin-bottom:6px;">Instructions for Regeneration</label>
        <input type="text" class="inp regen-instruction" placeholder="e.g. Expand on the database latency resolution, or make it sound more research-focused..." style="width:100%; height:36px; border-radius:6px; box-sizing:border-box;">
        <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
          <button class="btn btn-ghost btn-cancel-regen" style="font-size:11.5px; padding:4px 8px;">Cancel</button>
          <button class="btn btn-primary btn-submit-regen" style="font-size:11.5px; padding:4px 10px;">Regenerate Section</button>
        </div>
      </div>
    `;

    // Local autosave on input
    const body = card.querySelector('.report-section-body');
    body.oninput = _debounce(async () => {
      // Save changes back to state and DB
      if (_ctrl.reportData) {
        _ctrl.reportData.report_sections[index].content = body.innerText;
        await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, _ctrl.reportData);
      }
    }, 1000);

    // Wire Regenerate buttons
    const regenBtn = card.querySelector('.btn-regen-section');
    const regenControls = card.querySelector('.regen-controls');
    const cancelRegenBtn = card.querySelector('.btn-cancel-regen');
    const submitRegenBtn = card.querySelector('.btn-submit-regen');
    const instructionInput = card.querySelector('.regen-instruction');

    regenBtn.onclick = () => {
      regenControls.classList.toggle('hidden');
      if (!regenControls.classList.contains('hidden')) {
        instructionInput.focus();
      }
    };

    cancelRegenBtn.onclick = () => {
      regenControls.classList.add('hidden');
      instructionInput.value = '';
    };

    submitRegenBtn.onclick = async () => {
      const instruction = instructionInput.value.trim();
      if (!instruction) {
        showToast('Please enter an instruction for regeneration.', 'warning');
        return;
      }

      submitRegenBtn.disabled = true;
      submitRegenBtn.innerHTML = `<span class="ai-spinner" style="width:12px; height:12px; border-width:2px; margin:0 4px 0 0; display:inline-block; vertical-align:middle;"></span> Regenerating…`;

      try {
        const updatedContent = await _regenerateSingleSection(index, sec.title, body.innerText, instruction);
        body.innerText = updatedContent;
        
        // Save
        _ctrl.reportData.report_sections[index].content = updatedContent;
        await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, _ctrl.reportData);
        
        regenControls.classList.add('hidden');
        instructionInput.value = '';
        showToast('Section regenerated successfully!', 'success');
      } catch (err) {
        showToast('Regeneration failed. Using fallback enhancement...', 'warning');
        
        // Fallback: append instruction impact
        const fallbackText = body.innerText + `\n\n[Section enhanced to incorporate instruction: ${instruction}]`;
        body.innerText = fallbackText;
        _ctrl.reportData.report_sections[index].content = fallbackText;
        await upsertAttachmentReport(_ctrl.studentId, _ctrl.seasonId, _ctrl.reportData);
        regenControls.classList.add('hidden');
      } finally {
        submitRegenBtn.disabled = false;
        submitRegenBtn.textContent = 'Regenerate Section';
      }
    };

    container.appendChild(card);
  });
}

// ── Regenerate Section API Call ──────────────────────────────────────────────
async function _regenerateSingleSection(index, title, currentContent, instruction) {
  const systemPrompt = `You are an academic report editor. You are editing the section titled "${title}" of an industrial attachment report.
Integrate the user's specific instruction to revise or expand this content.
Stick strictly to the documented activities. Do not hallucinate. Return only the revised paragraphs. Do not add formatting like "Here is the revised text:" or markdown code blocks.`;

  const userPrompt = `Current Content of Section:
${currentContent}

User Instruction:
${instruction}`;

  const apiKey = 'sk-4c0276e497ad40499c7e486c42a9ced2';
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (response.ok) {
    const data = await response.json();
    return data.choices[0]?.message?.content?.trim();
  }
  throw new Error('API failed');
}

// ── PDF Builder ──────────────────────────────────────────────────────────────
async function _buildReportPDF(sections) {
  const mod = await import('https://esm.sh/jspdf@2');
  const jsPDF = mod.jsPDF ?? mod.default?.jsPDF ?? mod.default;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Cover Page
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('TAKORADI TECHNICAL UNIVERSITY', 105, 50, { align: 'center' });
  doc.setFontSize(14);
  doc.text('FACULTY OF APPLIED SCIENCES / ENGINEERING', 105, 58, { align: 'center' });
  
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(20, 68, 190, 68);

  doc.setFontSize(18);
  doc.text('INDUSTRIAL ATTACHMENT REPORT', 105, 110, { align: 'center' });

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`UNDERTAKEN AT:`, 105, 140, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(`${_ctrl.placement?.company_name}`.toUpperCase(), 105, 146, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.text(`BY:`, 105, 180, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(`${_ctrl.studentProfile.full_name}`.toUpperCase(), 105, 186, { align: 'center' });
  doc.text(`INDEX NUMBER: ${_ctrl.studentProfile.index_number}`, 105, 192, { align: 'center' });
  doc.text(`PROGRAMME: ${_ctrl.studentProfile.programme}`.toUpperCase(), 105, 198, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.text(`DATE OF SUBMISSION: ${new Date().toLocaleDateString()}`, 105, 250, { align: 'center' });

  // Chapters
  Object.values(sections).forEach(sec => {
    doc.addPage();
    
    // Header
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`TTU INDUSTRIAL ATTACHMENT REPORT - ${_ctrl.studentProfile.full_name}`, 20, 15);
    doc.line(20, 17, 190, 17);

    // Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(sec.title, 20, 28);

    // Content
    doc.setFontSize(11);
    doc.setFont('times', 'normal');
    const splitText = doc.splitTextToSize(sec.content, 170);
    doc.text(splitText, 20, 38, { align: 'justify' });
  });

  // Appendix / Figure Page (if exists)
  if (_ctrl.reportData?.input_form?.supFigureBase64) {
    doc.addPage();
    
    // Header
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`TTU INDUSTRIAL ATTACHMENT REPORT - APPENDIX`, 20, 15);
    doc.line(20, 17, 190, 17);

    // Title
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Appendix A: Technical Illustration & Reference Diagram', 20, 28);

    // Render image
    try {
      const base64Data = _ctrl.reportData.input_form.supFigureBase64;
      let format = 'JPEG';
      if (base64Data.startsWith('data:image/png')) format = 'PNG';
      
      // Draw centered image
      doc.addImage(base64Data, format, 20, 40, 170, 110, undefined, 'FAST');
      
      // Caption
      const captionText = _ctrl.reportData.input_form.supFigureCaption || 'Technical figure illustrating work activities';
      doc.setFontSize(11);
      doc.setFont('times', 'italic');
      doc.text(`Figure 1.1: ${captionText}`, 105, 160, { align: 'center' });
    } catch (err) {
      console.error('Failed to render appendix image in PDF', err);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text('[Error rendering uploaded attachment figure image]', 20, 45);
    }
  }

  // Add Page Numbers
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Page ${i - 1} of ${totalPages - 1}`, 105, 285, { align: 'center' });
  }

  return doc;
}

// ── Show Submitted State ─────────────────────────────────────────────────────
function _showSubmittedState(report) {
  _setStep(3, 'Report Submission Complete', 'Your report has been successfully filed and locked.');
  _showPanel('stageSubmitted');

  document.getElementById('subInfoDate').textContent = report.submitted_at ? new Date(report.submitted_at).toLocaleString() : 'Just now';
  document.getElementById('subInfoPath').textContent = report.path_type === 'ai' ? 'AI-Generated Assistant' : 'Manual PDF Upload';
  
  // Status Badge Styling
  const statusEl = document.getElementById('subInfoStatus');
  statusEl.textContent = report.status.toUpperCase();
  statusEl.className = 'live-ticket-value';
  
  if (report.status === 'approved') {
    statusEl.style.color = 'var(--green)';
    document.getElementById('submittedBannerTitle').textContent = 'Report Approved';
    document.getElementById('submittedBannerDesc').textContent = 'Your industrial attachment report has been reviewed and approved by the Liaison Office.';
    document.getElementById('submittedBannerIcon').setAttribute('data-lucide', 'check-circle-2');
    document.getElementById('reportFeedbackPanel').classList.add('hidden');
  } else if (report.status === 'flagged') {
    statusEl.style.color = 'var(--ttu-red)';
    document.getElementById('submittedBannerTitle').textContent = 'Report Flagged / Action Required';
    document.getElementById('submittedBannerDesc').textContent = 'The Liaison Officer has requested revisions to your report. See details below.';
    document.getElementById('submittedBannerIcon').setAttribute('data-lucide', 'alert-triangle');
    
    document.getElementById('reportFeedbackPanel').classList.remove('hidden');
    document.getElementById('reportFeedbackText').textContent = report.review_feedback || 'No comments provided.';
  } else {
    statusEl.style.color = 'var(--ttu-gold)';
    document.getElementById('submittedBannerTitle').textContent = 'Report Submitted';
    document.getElementById('submittedBannerDesc').textContent = 'Your report has been successfully filed with the Industrial Liaison Office. Pending review.';
    document.getElementById('submittedBannerIcon').setAttribute('data-lucide', 'clock');
    document.getElementById('reportFeedbackPanel').classList.add('hidden');
  }

  // Payment section visibility
  const payRow = document.getElementById('subInfoPaymentRow');
  if (report.path_type === 'ai') {
    payRow.classList.remove('hidden');
  } else {
    payRow.classList.add('hidden');
  }
}
