const express = require("express");
const app = express();
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const port = process.env.PORT || 5000;
const User = require("./models/user.js");
const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET;

//middleware
app.use(
  cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
  })
);
app.use(express.json());

//mongoose connection

try {
  mongoose.connect(process.env.MONGODB_URL);
} catch (error) {
  console.error(error);
}

app.get("/", (req, res) => {
  res.send("server is running");
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const createdUser = await User.create({ username, password });
    jwt.sign({ userId: createdUser._id }, jwtSecret, {}, (err, token) => {
      if (err) throw err;
      res.cookie("token", token).status(201).json({
        _id: createdUser._id,
      });
    });
  } catch (error) {
    console.error(error);
  }
});

app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});
