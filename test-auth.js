import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err));

  console.log('Navigating to http://localhost:5173/');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });

  // wait 1 second to see any redirects
  await new Promise(r => setTimeout(r, 1000));
  
  console.log('Current URL:', page.url());

  if (page.url().includes('login.html')) {
    console.log('Redirected to login successfully. Entering credentials...');
    await page.type('#login-id', 'TTU/CS/24/001'); // student index
    await page.type('#login-password', 'password');
    await page.click('#btn-signin');
    
    // wait 2 seconds for sign-in processing and redirect
    await new Promise(r => setTimeout(r, 2000));
    
    console.log('Post-login URL:', page.url());
  }

  await browser.close();
})();
