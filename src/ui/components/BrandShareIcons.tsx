/**
 * Official-style share icons: Telegram (blue disc, white paper plane) and
 * WhatsApp (green disc, white speech-bubble handset), drawn as compact SVGs
 * in each brand's colour.
 */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

export function TelegramIcon({ size = 56 }: { size?: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Circle cx={24} cy={24} r={24} fill="#229ED9" />
      <Path
        d="M34.9 14.2 30.8 33.4c-.3 1.3-1.1 1.6-2.2 1l-6.1-4.5-2.9 2.8c-.3.3-.6.6-1.2.6l.4-6.2L30 17c.5-.4-.1-.7-.8-.3l-14 8.8-6-1.9c-1.3-.4-1.3-1.3.3-1.9l23.5-9.1c1.1-.4 2.1.3 1.9 1.6Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

export function WhatsAppIcon({ size = 56 }: { size?: number }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Circle cx={24} cy={24} r={24} fill="#25D366" />
      {/* speech bubble */}
      <Path
        d="M24 10.5c-7.4 0-13.4 6-13.4 13.4 0 2.4.6 4.6 1.8 6.6L10.5 37l6.7-1.8c1.9 1.1 4.2 1.7 6.8 1.7 7.4 0 13.4-6 13.4-13.4S31.4 10.5 24 10.5Zm0 24.4c-2.3 0-4.4-.6-6.2-1.7l-.4-.3-4 1.1 1.1-3.9-.3-.4a10.9 10.9 0 1 1 9.8 5.2Z"
        fill="#FFFFFF"
      />
      {/* handset */}
      <Path
        d="M29.9 26.6c-.3-.2-1.9-1-2.2-1.1-.3-.1-.5-.2-.7.2-.2.3-.8 1.1-1 1.3-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.3-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7s1.2 3.1 1.3 3.4c.2.2 2.3 3.5 5.6 4.9.8.3 1.4.5 1.9.7.8.2 1.5.2 2 .1.6-.1 1.9-.8 2.1-1.5.3-.7.3-1.4.2-1.5l-.7-.4Z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}
