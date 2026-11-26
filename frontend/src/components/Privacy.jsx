import React from 'react';
import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <article className="mx-auto max-w-2xl space-y-6 px-4 py-8" style={{ color: 'var(--text-primary)' }}>
      <h1 className="text-3xl font-bold">Privacy on GridLock</h1>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Playing as a guest</h2>
        <p>You can play without signing in. GridLock uses your chosen player name and game activity to run matches and show results. Your player name and results can appear in rankings, profiles, or replays. The browser stores preferences and some play data locally. You can clear that data in your browser’s site settings.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Signing in</h2>
        <p>Google sign-in is optional. When you sign in, GridLock uses your Google account identifier, email, display name, and profile image to create an account and link your progress. GridLock also uses a sign-in cookie. Your email is shown to you in Settings and is separate from your public player name.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Rooms, chat, and notifications</h2>
        <p>Chat messages are sent to other people in the room. People who have a room or replay link may be able to view the game. Keep personal information out of player names and chat. GridLock stores friend requests and accepted friendships for signed-in players. Accepted friends can invite each other to a room. If you enable notifications, GridLock stores a browser push subscription to deliver invites and turn reminders. You can turn notifications off in Settings or in your browser.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Error and performance monitoring</h2>
        <p>The production site uses Sentry to diagnose errors and measure performance. This can include technical information about your browser, the app version, errors, and sampled timing data. Session replay is off by default. The host also processes network requests to run and protect the service.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Deleting your account or requesting help</h2>
        <p>If you signed in, open <Link to="/settings" className="underline">Settings</Link> and choose Delete Account. GridLock removes your account and detaches it from existing game records. Results or player names can remain in historical records.</p>
        <p>For guest data or other privacy questions, <a href="https://github.com/DhananjayThomble/GridLock/discussions" className="underline">ask the maintainer for a private way to follow up</a>. GitHub Discussions is public, so leave out account details, room codes, and personal information.</p>
      </section>
    </article>
  );
}
