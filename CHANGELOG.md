## 0.0.3
- `[critical]` Added missing callback for the unsubscribe method.
- `[minor]` Introduced a new `online` event for the Pub/Sub so you know when the
  subscription is ready and starts processing messages.
- `[minor]` Don't emit empty messages.

## 0.0.2

- `[doc]` Added documentation for the Pub/Sub channels
- `[critical]` Upgraded to the latest [underverse](/observing/underverse) which
  introduced a forced `underverse.cursor` set before starting. This way we can
  queue messages by checking if the `underverse.position` is active. If we don't
  do this we will fetch up to the backlog in messages when we join for the first
  time.

## 0.0.1

## 0.0.0

- Initial release
