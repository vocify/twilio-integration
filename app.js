const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = express();
require("express-ws")(app);
app.use(express.json());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
const port = 8080;

const {
  handleRealTimeStream,
} = require("./RealtimeStream/twilioRealTimeStreamwithspeakr");

app.ws("/socket/:campaignID/:clientID/:ClientName", handleRealTimeStream);

app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});
