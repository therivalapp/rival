import { Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { isSimulatorChannel } from '../../lib/simulatorUpdates';

// Simulator-only: which update is running, bottom left, so a screenshot shows
// whether the latest fix has loaded. Nothing anywhere else.
export function SimUpdateTag() {
  if (!isSimulatorChannel) return null;
  const at = Updates.createdAt ? Updates.createdAt.toISOString().slice(11, 16) + ' UTC' : 'built-in';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 4, bottom: 2, zIndex: 9999 }}>
      <Text style={{ fontSize: 9, color: '#0f0', backgroundColor: 'rgba(0,0,0,0.6)' }}>{`update ${at}`}</Text>
    </View>
  );
}
