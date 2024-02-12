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
    console.error(error);
  }
});

const server = app.listen(port, () => {
  console.log(`Server is running on ${port}`);
});

//webscoket server
const wss = new ws.WebSocketServer({ server });

wss.on("connection", (connection, req) => {
  //read username and id from the cookie for this connection

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
    const { recipent, text } = parsedMessage;

    if (recipent && text) {
      const messageDoc = await MessageModel.create({
        Sender: connection.userId,
        recipent,
        text,
      });
      [...wss.clients]
        .filter((c) => c.userId === recipent)
        .forEach((c) =>
          c.send(
            JSON.stringify({
              id: messageDoc._id,
              text,
              sender: connection.userId,
              recipent,
            })
          )
        );
    }
  });

  //notify every client about online people (when someone connects)

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
});
