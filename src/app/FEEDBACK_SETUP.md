# Feedback System Setup

## Google Sheets Integration

To enable the feedback functionality, you'll need to set up a Google Apps Script Web App that connects to a Google Sheet.

### Step 1: Create a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it "Tiny Viewers Feedback" 
3. In the first row, add these column headers:
   - A1: `Timestamp`
   - B1: `Name`
   - C1: `Email`
   - D1: `Comments`

### Step 2: Create Google Apps Script

1. In your Google Sheet, click **Extensions** → **Apps Script**
2. Delete the default code and paste this script:

```javascript
function doPost(e) {
  try {
    // Get the active spreadsheet
    const sheet = SpreadsheetApp.getActiveSheet();
    
    // Parse the JSON data from the request
    const data = JSON.parse(e.postData.contents);
    
    // Add a new row with the feedback data
    sheet.appendRow([
      data.timestamp,
      data.name || 'Anonymous',
      data.email || 'Not provided',
      data.comments
    ]);
    
    // Return success response
    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    // Return error response
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: false, 
        error: error.toString() 
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

### Step 3: Deploy the Web App

1. Click **Deploy** → **New deployment**
2. Choose type: **Web app**
3. Set execute as: **Me**
4. Set access: **Anyone** (this allows the Next.js app to send data)
5. Click **Deploy**
6. Copy the **Web app URL** (it will look like: `https://script.google.com/macros/s/...../exec`)

### Step 4: Add Environment Variable

Create a `.env.local` file in your project root (if it doesn't exist) and add:

```
GOOGLE_SHEETS_URL=your_web_app_url_here
```

Replace `your_web_app_url_here` with the URL you copied in Step 3.

**Important:** Make sure `.env.local` is in your `.gitignore` file to keep your credentials secure.

### Step 5: Test the Integration

1. Restart your Next.js development server (`npm run dev`)
2. Click the "Feedback" button on any page
3. Fill out and submit the form
4. Check your Google Sheet to see if the data appears

## Features

The feedback system includes:
- **Simple Form**: Name (optional), Email (optional), Comments (required)
- **Whimsical Design**: Matches your app's pink/purple/emerald theme
- **Smooth Animations**: Modal appears with elegant transitions
- **Thank You Message**: Confirmation after successful submission
- **Error Handling**: User-friendly error messages if submission fails
- **Loading States**: Visual feedback during form submission

## Troubleshooting

- If feedback submission fails, check the browser console for errors
- Verify the Google Apps Script Web App is deployed with "Anyone" access
- Make sure the `.env.local` file has the correct URL
- Check that the Google Sheet has the correct column headers
- Ensure your development server is restarted after adding environment variables

## Security Note

The Google Apps Script is set to "Anyone" access, which is required for the web app to receive data from your Next.js app. The script only accepts POST requests with the expected data format, providing basic security through obscurity. 