import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import fs from 'fs';

dotenv.config();

const SHEET_ID = process.env.SHEET_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: 'credentials.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function scrapePrice(url) {
  const browser = await puppeteer.launch({
    headless: 'new',
  });

  const page = await browser.newPage();
  await page.goto(url);
  await page.waitForTimeout(2000); // Adjust if needed

  const priceElement = await page.$('.price');
  const price = priceElement
    ? await page.evaluate(el => el.textContent.trim(), priceElement)
    : 'N/A';

  await browser.close();
  return price;
}

async function run() {
  console.log('🔥 THIS IS THE NEW VERSION');
  console.log('🚀 scrape.js file loaded');
  console.log('🟢 run() function started');
  console.log('🕒 Current time:', new Date().toISOString());

  const url = 'https://www.mac.bid/search?aid=52163&lid=3598G';
  console.log('🔍 Scraping row 3:', url);

  try {
    const price = await scrapePrice(url);
    console.log(`💰 Price for row 3: ${price}`);
  } catch (error) {
    console.error('❌ Scrape failed:', error);
    process.exit(1);
  }
}

run();