import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';

export async function downloadPdfLetter(letter, profile) {
  // Create a new PDF document (A4 portrait)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const margin = 20;
  const pageWidth = doc.internal.pageSize.width;
  let cursorY = margin;

  // --- Header ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(26, 58, 140); // TTU Blue
  doc.text('TAKORADI TECHNICAL UNIVERSITY', pageWidth / 2, cursorY, { align: 'center' });
  cursorY += 8;

  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text('Industrial Attachment Management System (IAMS)', pageWidth / 2, cursorY, { align: 'center' });
  cursorY += 6;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('P.O. Box 256, Takoradi, Ghana | info@ttu.edu.gh', pageWidth / 2, cursorY, { align: 'center' });
  cursorY += 15;

  doc.setLineWidth(0.5);
  doc.line(margin, cursorY, pageWidth - margin, cursorY);
  cursorY += 10;

  // --- Date & Ref ---
  doc.setFontSize(11);
  const letterDate = new Date(letter.generated_at).toLocaleDateString('en-GH', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  doc.text(`Date: ${letterDate}`, margin, cursorY);
  doc.text(`Ref: IAMS/${letter.verification_code}`, pageWidth - margin, cursorY, { align: 'right' });
  cursorY += 15;

  // --- Recipient Address ---
  doc.setFont('helvetica', 'bold');
  doc.text('The Human Resource Manager,', margin, cursorY);
  cursorY += 6;
  doc.text(letter.company_name, margin, cursorY);
  cursorY += 6;
  doc.setFont('helvetica', 'normal');
  doc.text(letter.contact_person, margin, cursorY);
  cursorY += 6;
  doc.text(`${letter.street_landmark}, ${letter.city_town}`, margin, cursorY);
  cursorY += 6;
  doc.text(letter.region, margin, cursorY);
  cursorY += 15;

  // --- Salutation ---
  doc.text('Dear Sir/Madam,', margin, cursorY);
  cursorY += 10;

  // --- Subject ---
  doc.setFont('helvetica', 'bold');
  doc.text('LETTER OF INTRODUCTION FOR INDUSTRIAL ATTACHMENT', margin, cursorY);
  doc.setLineWidth(0.2);
  doc.line(margin, cursorY + 1, margin + 115, cursorY + 1);
  cursorY += 10;

  // --- Body ---
  doc.setFont('helvetica', 'normal');
  const bodyText = `We introduce to you ${profile.full_name}, a student of Takoradi Technical University pursuing a programme in ${profile.programme} (Level ${profile.level}). As part of the requirements for the award of a degree/diploma, students are expected to undertake an industrial attachment to gain practical experience.

We would be grateful if you could offer the student an opportunity to undertake this attachment in your esteemed organisation.

The student's details are as follows:
- Name: ${profile.full_name}
- Index Number: ${profile.index_number}
- Department: ${profile.department}

We hope this request will be favourably considered. Please verify the authenticity of this letter at iams.ttu.edu.gh using the verification code: ${letter.verification_code}.`;

  const splitText = doc.splitTextToSize(bodyText, pageWidth - (margin * 2));
  doc.text(splitText, margin, cursorY);
  
  cursorY += (splitText.length * 5) + 15;

  // --- Sign-off ---
  doc.text('Yours faithfully,', margin, cursorY);
  cursorY += 20; // Space for signature
  
  doc.setFont('helvetica', 'bold');
  doc.text('Industrial Liaison Officer', margin, cursorY);
  cursorY += 5;
  doc.setFont('helvetica', 'normal');
  doc.text('Takoradi Technical University', margin, cursorY);

  // --- Save ---
  const fileName = `TTU_Attachment_Letter_${profile.index_number}_${letter.company_name.replace(/\s+/g, '_')}.pdf`;
  doc.save(fileName);
}
