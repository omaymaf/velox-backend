// backend/src/services/calendarService.js
const { google } = require("googleapis");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CALENDAR_CLIENT_ID,
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  process.env.GOOGLE_CALENDAR_REDIRECT_URI,
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

async function getUpcomingEvents(maxResults = 5, daysAhead = 7) {
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: future.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  const events = res.data.items || [];
  return events.map((e) => ({
    id: e.id,
    title: e.summary || "Sans titre",
    description: e.description || "",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    location: e.location || "",
    allDay: !e.start?.dateTime,
  }));
}

function getAuthUrl() {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.readonly"],
    prompt: "consent",
  });
}

async function getTokensFromCode(code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

module.exports = { getUpcomingEvents, getAuthUrl, getTokensFromCode };
