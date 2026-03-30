// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  // ── Identity ──
  googleId: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },

  // ── Profile ──
  displayName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 16,
    match: /^[a-zA-Z0-9_-]+$/,
  },
  usernameSetupComplete: {
    type: Boolean,
    default: false,
  },
  avatar: {
    type: String,
    default: null,
  },

  // ── Metadata ──
  lastLoginAt: {
    type: Date,
    default: Date.now,
  },

  // ── Data Migration ──
  migratedFromGuest: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', UserSchema);
