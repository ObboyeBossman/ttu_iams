const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Go to login
  await page.goto('http://localhost:5173/src/modules/auth/login.html');
  await page.type('#email', 'kwame.asante@ttu.edu.gh');
  await page.type('#password', 'TestPass123!');
  await page.click('#loginBtn');
  
  // Wait for dashboard to load
  await page.waitForNavigation();
  
  // Go to report page
  await page.goto('http://localhost:5173/src/modules/student/dashboard.html#attachment-report');
  
  // Wait for the report workspace to be visible
  await page.waitForSelector('#reportWorkspace:not(.hidden)', { timeout: 10000 });
  
  // Check the button
  const result = await page.evaluate(() => {
    const btn = document.querySelector('.path-cta-ai');
    return {
      exists: !!btn,
      hasOnclick: btn ? !!btn.onclick : false,
      classList: btn ? Array.from(btn.classList) : []
    };
  });
  
  console.log('Button test result:', result);
  
  await browser.close();
})();
