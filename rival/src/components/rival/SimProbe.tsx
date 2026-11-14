import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { subscribeSimLog } from '../../lib/simLog';
import * as Updates from 'expo-updates';
import { isSimulatorChannel } from '../../lib/simulatorUpdates';

// Simulator-only: which update is running, bottom left, so a screenshot shows
// whether the latest fix has loaded. Nothing anywhere else.
export function SimUpdateTag() {
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => (isSimulatorChannel ? subscribeSimLog(setLog) : undefined), []);
  if (!isSimulatorChannel) return null;
  const at = Updates.createdAt ? Updates.createdAt.toISOString().slice(11, 16) + ' UTC' : 'built-in';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 4, bottom: 2, zIndex: 9999 }}>
      {log.map((l, i) => <Text key={i} style={{ fontSize: 9, color: '#ff0', backgroundColor: 'rgba(0,0,0,0.7)', maxWidth: 380 }}>{l}</Text>)}
      <Text style={{ fontSize: 9, color: '#0f0', backgroundColor: 'rgba(0,0,0,0.6)' }}>{`update ${at}`}</Text>
    </View>
  );
}
