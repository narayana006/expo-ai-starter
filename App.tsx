import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CHAT_API_URL } from './src/config';
import { createProxyTransport } from './src/lib/transport';
import { ChatScreen } from './src/screens/ChatScreen';

export default function App() {
  const transport = useMemo(() => createProxyTransport(CHAT_API_URL), []);
  return (
    <SafeAreaProvider>
      <ChatScreen transport={transport} />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
