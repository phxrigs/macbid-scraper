import puppeteer from 'puppeteer';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import fs from 'fs';

console.log('🔥 THIS IS THE NEW VERSION');

dotenv.config();

const SHEET_ID = process.env.SHEET_ID;
const CREDENTIALS = JSON.parse(fs.readFileSync('./credentials.json'));

async function scrapePrice(url) {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  try {
    await page.waitForSelector('.h1.font-weight-normal.text-accent.mb-0', { timeout: 5000 });

    const price = await page.evaluate(() => {
      const container = document.querySelector('.h1.font-weight-normal.text-accent.mb-0');
      if (!container) return null;

      const spans = container.querySelectorAll('span');
      const priceSpan = spans[1];
      if (!priceSpan) return null;

      const fullText = priceSpan.textContent || '';
      return fullText.replace('$', '').replace(/\s/g, '').trim();
    });

    await browser.close();
    return price;
  } catch (err) {
    await browser.close();
    console.error(`❌ Failed to extract price from ${url}:`, err.message);
    return null;
  }
}

async function run() {
  console.log('🟢 run() function started');
  const now = new Date();
  console.log('🕒 Current time:', now.toISOString());

  const auth = new google.auth.GoogleAuth({
    credentials: CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/gmail.send']
  });

  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const sheetName = 'InHunt'; // Make sure this matches your actual sheet tab name

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1:W`,
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) {
    console.log('No data found.');
    return;
  }

  const header = rows[0];
  const dataRows = rows.slice(1);

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowIndex = i + 2; // Account for header row

    const url = row[13]; // Column N
    const email = row[2]; // Column C
    const bidEnd = row[21]; // Column V
    const alertSent = row[22]; // Column W

    if (!url || !url.startsWith('http')) continue;

    console.log(`🔍 Scraping row ${rowIndex}: ${url}`);

    const price = await scrapePrice(url);
    const priceToWrite = price || 'X';

    console.log(`💰 Price for row ${rowIndex}: ${priceToWrite}`);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!R${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[priceToWrite]],
      },
    });

    if (bidEnd && !alertSent && email && price) {
      const bidEndTime = new Date(bidEnd);
      const timeDiff = (bidEndTime - now) / (1000 * 60); // in minutes

      if (timeDiff <= 30 && timeDiff > 0) {
        const subject = `⏰ Auction Ending Soon`;
        const body = `The auction ending at ${bidEndTime.toLocaleString()} is closing in ${Math.round(timeDiff)} minutes.\n\nCurrent bid: $${price}\n\nLink: ${url}`;

        try {
          await google.gmail({ version: 'v1', auth: await auth.getClient() }).users.messages.send({
            userId: 'me',
            requestBody: {
              raw: Buffer.from(
                `To: ${email}\r\nSubject: ${subject}\r\n\r\n${body}`
              ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
            },
          });

          await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${sheetName}!W${rowIndex}`,
            valueInputOption: 'RAW',
            requestBody: {
              values: [[new Date().toISOString()]],
            },
          });

          console.log(`📧 Alert sent to ${email} for row ${rowIndex}`);
        } catch (e) {
          console.error(`❌ Failed to send email to ${email}:`, e.message);
        }
      }
    }
  }
}

run();
