# Hardware signing: what the app draws and why

This note describes how Talia guides a client through a hardware signing
device (Ledger Nano Gen5, Flex, Stax and Nano X; BitBox02 Nova): the drawn
device, the pages it steps through, the hints on its controls and the rules
the code keeps. `src/ui/__tests__/hwwSigning.test.ts` checks that the code
and this note agree, and the pure modules named below carry their own tests.

Paths are relative to `src/ui/` unless they say otherwise.

## Colours of the drawn devices

Every colour in the app comes from the theme (`theme/colors.ts`). The drawn
devices are the one sanctioned exception to theme tokens, like the exchange
and provider logos: they are other products' own colours, which do not
change with the app's palette. They live in `components/deviceArtPalette.ts`
and nowhere else. Everything else in the drawings and in the courier is a
theme token, and the test refuses a colour literal anywhere else in them.

## The courier (signing, design A)

Once a Bluetooth device has answered and the transaction is on its way, the
signing step draws `components/SigningCourier` in place of the connection
flow's step line: a drawn phone on the left, the device on the right and the
path between them. Only the two screens that SIGN draw it, the signing
screen and the refresh session, and both mount it through the one hook
`hooks/useSigningCourier.tsx`. Registration and the address check keep their
own lines.

1. Sending: the key's name, "Sending the transaction to the Ledger.", one bar
   along the path toward the device.
2. The client's turn, titled "3. Sign the transaction" (see the numbered
   steps below): no bar and no phone button. The phone greys, the device
   lights in the one green, and the drawing steps through the device's own
   review pages on a timer. It holds the last page ("Hold to sign", "Sign
   transaction" or the Nova's Total) as long as the longest page and at
   least `HOLD_PAGE_MS`, then starts again from the first, round and round
   for as long as the turn lasts, so a client who missed a page sees it
   again. The tour is a guide on a timer: no sentence ever says it shows the
   page the device is on.
3. Coming back: "Receiving the signed transaction.", the bar filling back
   toward the phone, then "Signed. Sending it to the network." When the
   signature completes the spend, the courier broadcasts it through the
   screen's one broadcast and lands on the Sent page.

The BitBox has no bars, because it sends and receives the transaction at
once: one pulse each way, a short beat, then its turn until the signing call
answers. A decline reads "You declined on the Ledger. Nothing was sent."

## The press hint (design C)

The press hint is design C, "Lit control, one word" (decided 2026-10-03: "lets go with C"):
the control to press is ringed in the one green and pulses, the press fills
it, then the page turns, with one word on a pill that never covers the
device's own words. "Tap" on the touchscreens' footer arrow and "Hold" on
their sign tile; "Press" and "Press both" on the Nano X; on the Nova "Tap" on
the top right edge, then on Total "Hold" and "Hold both" once the up arrow
shows at the bottom right, the two arrows sliding together until the device
confirms. So the Nova's line reads
"hold the top right edge, then the bottom right edge too".
With Reduce Motion the hint is still.

What plays when is `components/pressHintScript.ts` (pure, tested), drawn by
`PressHint` on each drawing's anchors. The hint and the device's own progress
move on one native-driver clock that the tour starts again with every pass.

## The turns before the transaction (decided 2026-10-04)

The Ledger's two asks that the kit reports exactly, the PIN and the app to
open, are drawn as the client's turn too (`components/DeviceTurn`, over
`hww/deviceTurns.ts`, pure, tested), on the same one-clock loop with the
press hint on the control to press. The touchscreens start off: the PIN
guide opens on an empty screen with "Press" on the side button, and the line
says to press it IF the device is off, because a short press on a device
that is on puts it to sleep. The touchscreens' keypad is shuffled on every
pass, as the device shuffles it every time it asks.

The touchscreens' hold draws no ring round the tile: a thin dark line fills
left to right along the top edge of the "Hold to sign" row while the tile is
held (`TOUCH_SIGN_MS`). "Transaction signed" and "Transaction rejected" show
an outlined circle round the tick or the cross, never a filled disc
(`OutlinedDone`).

## The BitBox after it is plugged in

The phone cannot tell what the Nova shows between the moment it is plugged
in and the unlock answering, and the Nova is only found once its side is
chosen. So the guide is drawn while the search runs, device first:
"Tap this side" round the turning arrow, then the password entry, the confirmation,
the lock and the splash, round and round. The flow draws the device it
expects (the model the vault recorded, or the one the client just picked),
never a generic slab, above a short "Looking for your hardware…" line.

## Registering a vault

Every registration goes through `connectedDevice.registerVault`, which hands
the flow the facts the pages are made from (`registerFacts` in
`hww/vaultRegistration.ts`, pure, tested: the name as sent, the BIP-388
template, the keys in the policy's order, which key is the device's own).
`deviceTurn(d, 'register', network, facts)` draws them round and round, in
the firmwares' own words:

- the touchscreens: "Review account to register", the account name with the
  spending policy, one page per key, "Register account?" with Approve, then
  "Account registered";
- the Nano X: the same items, each key over pages of three lines broken
  where the device's own font breaks them (`hww/nanoFont.ts`), then
  "Account registered";
- the Nova: every page headed "Register", one scrolling line per key, with
  "Cosigner 1/3 (this device)" on the device's own key, held like Total.

Pages drawn from the firmwares' sources but not yet checked on a device are
marked unconfirmed in the code (`unconfirmed(facts)`): a policy vault on the
BitBox, the Ledgers' spending policy for anything but a plain k-of-n, and a
2-of-2's sentence. Without facts the flows keep their line.

## The address check

Receive keeps one "Verify on Hardware" button and no device step under the
QR. The button opens `VerifyAddress` (`screens/VerifyAddressScreen.tsx`) with
the exact address and index. That screen is the one hardware step: it lists
the owner's own keys with their recorded devices, never 21st Capital's, and
skips the list when they resolve to one device. Page two shows the address
large and grouped as Receive draws it, above the device drawn through its
own address pages (`AddressFacts` in `hww/addressCheck.ts`, pure, tested):

- the touchscreens: "Verify bitcoin address", the address and account name
  with Confirm, then the outlined tick over "Address verified";
- the Nano X: "Verify bitcoin address", the address over pages of three
  lines, then "Address verified";
- the Nova: every page headed "Receive to", the address in groups of four as
  one scrolling line, swiped along the lower edge to its end before the tap.

The safety rules: the address is derived again from the engine before the
device is asked; the address the device shows must equal the one the screen
was given; on a confirm the screen returns to Receive by itself with the
verdict, and the green sentence shows for that address only. And
a mismatch condemns the vault and blocks whatever address is on show, because the
device disagreed with the app's own derivation and no address of that vault
is safe. Receive does not offer the check until its first address is
confirmed through the engine, and hides the button while the address is
being replaced.

## Swiping the whole address

A client must be able to read the whole address the bitcoin goes to (decided
2026-10-05: "the only way to do that is to swipe through the entire address").
So on the Nova every amount's address in the signing review is swiped to its
end before the tap, exactly as on the address check: the line read, two
swipes along the lower edge, the end read, then the tap. The page's dwell is
`novaSwipePageMs` in `hww/signingDevice.ts`, and one builder in
`components/pressHintScript.ts` serves both guides.

## Numbered steps and the slide between them

The device's steps are numbered in the turn pages' titles. `hww/deviceSteps.ts`
(pure, tested) is the plan: the brand's two steps before the job, then the
job.

- A Ledger: "1. Enter your PIN on the Ledger", "2. Open the Bitcoin app",
  then "3. Register the vault", "3. Verify the address" or "3. Sign the
  transaction".
- A BitBox: "1. Tap the side facing you" (while the search runs), "2. Enter
  your password" (once found), then the same third step.

The number belongs to the ask, never to the path: a device that is already
unlocked skips a step and the next keeps its number. Two jobs in a row, such
as a registration followed by a signature, are both numbered 3 (decided
2026-10-05: "keep 3").

A new step slides in: `components/TurnSlide` wraps every page the two
connection flows draw, keyed by the step and, for the job, by which job, on
the app's `StepTransition` (native driver). A new page slides in from the
right, an earlier one from the left, and a page with no step of its own
swaps in place.

## The refresh session signs with the courier

The refresh session signs leg after leg with the same courier (decided
2026-10-05: "keep 3 and build the courier for refresh session too").
`hooks/useSigningCourier.tsx` is the one wiring of the courier, used by
`SignPsbtScreen` and `RefreshSessionScreen`, with no second copy: it holds
the feed, hands the connection step its ceremony page and the pinned footer
its buttons, and runs the signing per brand. Each transaction is its own
ceremony with its place in the batch ("Sending transaction 2 of 3 to the
Ledger."), and Try again keeps the legs already signed.
