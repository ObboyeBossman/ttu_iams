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
  await page.waitForSelector('#reportWorkspace:not(.hidden)');
  
  // Check the button
  const hasOnclick = await page.evaluate(() => {
    const btn = document.querySelector('.path-cta-ai');
    return btn ? !!btn.onclick : false;
  });
  
  console.log('Button has onclick:', hasOnclick);
  
  await browser.close();
})();
