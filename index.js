const express = require("express");
const app = express();
const cors = require("cors");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const port = process.env.PORT || 5000;
const User = require("./models/user.js");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const jwtSecret = process.env.JWT_SECRET;
const ws = require("ws");
const MessageModel = require("./models/message.js");
const user = require("./models/user.js");
const fs = require("fs");

//middleware
app.use(
  cors({
    credentials: true,
    origin: process.env.CLIENT_URL,
  })
);
app.use(express.json());
app.use(cookieParser());

//mongoose connection
try {
  mongoose.connect(process.env.MONGODB_URL);
} catch (error) {
  console.error(error);
}

//bcrypt salt
const bcryptSalt = bcrypt.genSaltSync(10);

app.get("/", (req, res) => {
  res.send("server is running");
});

app.get("/users", async (req, res) => {
  const users = await user.find();
  res.json(users);
});

app.get("/messages/:userId", async (req, res) => {
  const { userId } = req.params;
  const userData = await getUserDataFromReq(req);
  const senderId = userData.userId;

  try {
    const messages = await MessageModel.find({
      sender: { $in: [userId, senderId] },
      recipent: { $in: [userId, senderId] },
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function getUserDataFromReq(req) {
  const token = req.cookies?.token;
  return new Promise((resolve, reject) => {
    if (token) {
      jwt.verify(token, jwtSecret, {}, (err, userData) => {
        if (err) throw err;
        resolve(userData);
      });
    } else {
      reject("no token");
    }
  });
}

app.get("/profile", (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    jwt.verify(token, jwtSecret, {}, (err, userData) => {
      if (err) throw err;
      res.json(userData);
    });
  } else {
    res.status(422).json("NO TOKEN");
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const matchedUser = await User.findOne({ username });
  if (matchedUser) {
    const matchedPassword = bcrypt.compareSync(password, matchedUser.password);
    if (matchedPassword) {
      jwt.sign(
        { userId: matchedUser._id, username },
        jwtSecret,
        {},
        (err, token) => {
          if (err) throw err;
          res
            .cookie("token", token, { sameSite: "none", secure: true })
            .json({ id: matchedUser._id });
        }
      );
    } else {
      res.status(401).json("Username or Password not matched");
    }
  }
});

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, bcryptSalt);
    const createdUser = await User.create({
      username: username,
      password: hashedPassword,
    });
    jwt.sign(
      { userId: createdUser._id, username },
      jwtSecret,
      {},
      (err, token) => {
        if (err) throw err;
        res
          .cookie("token", token, { sameSite: "none", secure: true })
          .status(201)
          .json({
            id: createdUser._id,
          });
      }
    );
  } catch (error) {
    res.status(403).json("Username already exist");
  }
});

const server = app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});

//logout
app.use("/logout", (req, res) => {
  res
    .cookie("token", "", { sameSite: "none", secure: "true" })
    .json("logedout");
});

//webscoket server
const wss = new ws.WebSocketServer({ server });

wss.on("connection", (connection, req) => {
  function notifyOnlinePeople() {
    [...wss.clients].forEach((client) => {
      client.send(
        JSON.stringify({
          online: [...wss.clients].map((c) => ({
            userId: c.userId,
            userName: c.userName,
          })),
        })
      );
    });
  }
  //read username and id from the cookie for this connection

  connection.isAlive = true;

  connection.timer = setInterval(() => {
    connection.ping();
    connection.deathTimer = setTimeout(() => {
      connection.isAlive = false;
      clearInterval(connection.timer);
      notifyOnlinePeople();
    }, 1000);
  }, 5000);

  connection.on("pong", () => {
    clearTimeout(connection.deathTimer);
  });

  const cookie = req.headers.cookie;
  if (cookie) {
    const tokenCookieStr = cookie
      .split(";")
      .find((str) => str.startsWith("token="));
    if (tokenCookieStr) {
      const token = tokenCookieStr.split("=")[1];
      if (token) {
        jwt.verify(token, jwtSecret, {}, (err, userData) => {
          if (err) throw err;
          const { userId, username } = userData;
          connection.userId = userId;
          connection.userName = username;
        });
      }
    }
  }

  connection.on("message", async (message) => {
    const parsedMessage = JSON.parse(message);
    const { recipent, text, file } = parsedMessage;

    const fileUrl = file?.url;

    if (recipent && (text || file)) {
      const messageDoc = await MessageModel.create({
        sender: connection.userId,
        recipent,
        text,
        file: fileUrl || null,
      });
      [...wss.clients]
        .filter((c) => c.userId === recipent)
        .forEach((c) =>
          c.send(
            JSON.stringify({
              _id: messageDoc._id,
              text,
              sender: connection.userId,
              recipent,
              fileUrl,
            })
          )
        );
    }
  });

  //notify every client about online people (when someone connects)
  notifyOnlinePeople();
});
