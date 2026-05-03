Create a Telegram review message for the user.

The message should include:
- Draft ID
- Topic
- Core pain point
- Coaching advice summary
- Hook
- Full post
- Critic score
- Why this post may work
- Review instructions

The review instructions must mention:
- The user can approve with /approve {{draft_id}} or simply reply approve when there is only one pending draft
- The user can reject with /reject {{draft_id}} reason
- The user can rewrite with /rewrite {{draft_id}} instruction
- The user can also reply directly to the Telegram draft message with any rewrite instruction, and the system will send the revised draft back for review

The Telegram message should be concise but clear.

Output format should be plain text.
