const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname));
app.get('/timetracker-data.json', (req, res) => {
  res.sendFile(path.resolve(__dirname, '..', 'timetracker data.json'));
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`TimeTracker running at http://0.0.0.0:${PORT}`);
  console.log('Open on your phone: http://<your-computer-IP>:3000');
});
