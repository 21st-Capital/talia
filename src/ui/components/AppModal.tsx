/**
 * The app's Modal (decided 2026-09-16: "please make sure the user can ALWAYS come
 * out of a keyboard by just clicking any place outside of the keyboard. The
 * keyboard now is stuck unless the user clicks the return button").
 *
 * A Modal is its own window, so the tap-to-dismiss handler that wraps the app
 * root never sees a touch inside one: every modal has to carry its own. It was
 * carried by `AppDialog` and `DraggableSheet` alone, which left the rename
 * dialog on Arrange, the login sheet, the key sheet and the exchange screens
 * with a keyboard that only the return key could put away.
 *
 * So no screen mounts React Native's Modal directly: this one forwards every
 * prop and wraps the window's content in `KeyboardEscape`, which listens to
 * the bubbling touch so it never steals a tap from a button, a field or a
 * scrolling list. A test pins the rule.
 *
 * The app lock is drawn inside it too (decided 2026-09-26): a
 * modal is its own window ABOVE the app, so a lock drawn over the
 * navigator alone left an open sheet readable and usable. While the app is
 * locked or covered, the lock screen covers the modal's content; the modal
 * itself stays open underneath, so nothing typed in it is lost.
 */
import React, { useContext } from 'react';
import { Modal, View } from 'react-native';
import type { ModalProps } from 'react-native';
import { KeyboardEscape } from './KeyboardEscape';
import { LockContext, hiddenWhileLocked } from '../auth/lockState';
import { LockScreen } from '../auth/LockScreen';

export function AppModal({ children, ...rest }: ModalProps): React.JSX.Element {
  const lock = useContext(LockContext);
  return (
    <Modal {...rest}>
      <KeyboardEscape>
        {/* Always this one wrapper, so locking never remounts the content;
            hidden from VoiceOver while the lock is up (decided 2026-09-30). */}
        <View style={styles.fill} {...hiddenWhileLocked(!!lock?.visible)}>
          {children}
        </View>
        {lock?.visible && <LockScreen model={lock} />}
      </KeyboardEscape>
    </Modal>
  );
}

const styles = { fill: { flex: 1 } } as const;
