const url = 'https://bkbjejosgiybejsnxzmq.supabase.co/rest/v1/attachment_reports?student_id=not.is.null';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJrYmplam9zZ2l5YmVqc254em1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTAyMzIsImV4cCI6MjA5Nzc4NjIzMn0.47kyaH8JjcciQTSbjBHsCbCYJ947VL3tyhCfj1jvjVs';

async function clearReports() {
  console.log('Connecting to Supabase...');
  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });

    if (!response.ok) {
      console.error('Error deleting from Supabase:', response.status, response.statusText);
      const text = await response.text();
      console.error(text);
    } else {
      console.log('Successfully deleted mock reports from Supabase Remote DB.');
    }
  } catch (err) {
    console.error('Failed to make request:', err);
  }
  
  console.log('\n======================================================');
  console.log('IMPORTANT: You must also clear your browser LocalStorage!');
  console.log('Because the app caches the draft/report locally.');
  console.log('Go to your browser console on the student portal and run:');
  console.log('localStorage.clear(); location.reload();');
  console.log('======================================================\n');
}

clearReports();
