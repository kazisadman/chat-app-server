const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, unique: true },
    password: String,
  },
  { timestamp: true }
);

module.exports = mongoose.model('User',userSchema)
