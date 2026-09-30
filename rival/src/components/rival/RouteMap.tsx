import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { decodePolyline, projectRoute } from '../../lib/polyline';
import { RivalColors } from '../../constants/rivalTheme';

// A route drawn as a line on a warm panel: no map tiles, so no third-party
// map service sees where anyone trains. Only shown for people who chose to
// share routes with their teams.

const W = 400;
const H = 300;

export function RouteMap({ polyline, style }: { polyline: string; style?: StyleProp<ViewStyle> }) {
  const points = useMemo(() => projectRoute(decodePolyline(polyline), W, H, 28), [polyline]);
  if (points.length < 2) return null;
  const pts = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [sx, sy] = points[0];
  const [ex, ey] = points[points.length - 1];
  return (
    <View style={[styles.wrap, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <Polyline points={pts} fill="none" stroke={RivalColors.accentFill} strokeOpacity={0.25} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
        <Polyline points={pts} fill="none" stroke={RivalColors.accentText} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={sx} cy={sy} r={6} fill="#fff" />
        <Circle cx={ex} cy={ey} r={6} fill={RivalColors.accentFill} stroke="#fff" strokeWidth={2} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, overflow: 'hidden', backgroundColor: '#211c19' },
});
