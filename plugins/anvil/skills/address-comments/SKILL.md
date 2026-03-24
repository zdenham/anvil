---
name: address-comments
description: Address unresolved inline diff comments and mark them resolved
user-invocable: true
---

# Address Inline Comments

You have been asked to address unresolved inline diff comments. Review each comment below and make the requested changes.

## Unresolved Comments

$COMMENTS

## Resolving Comments

After you have addressed a comment, mark it as resolved by running:

anvil-resolve-comment "<comma-separated-comment-ids>"

Example: `anvil-resolve-comment "abc-123,def-456"`

You may resolve comments individually or in batches. Only resolve a comment after you have actually made the requested changes.
