import { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { projectRoute } from '../../lib/polyline';
import type { TrackPoint } from '../../lib/liveTrack';
import { RivalFontFamily } from '../../constants/rivalTheme';

// The route of the activity being recorded (Ricky, 2026-11-02,
// design/live-run-mockup.png): Start marked with a play sign, the far end
// either Now (still running) or Finish with a chequered flag. Drawn as a line
// with no map tiles, like RouteMap, so no map service sees it. Only ever
// shown to the person recording it.

const LINE = '#e8835f';
const PEACH = '#ffb59e';

export function LiveRoute({ track, width, height, end, style }: {
  track: TrackPoint[];
  width: number;
  height: number;
  end: 'now' | 'finish';
  style?: StyleProp<ViewStyle>;
}) {
  const small = height < 140;
  const pad = small ? 18 : 48;
  const pts = useMemo(() => projectRoute(track.map((p) => [p.lat, p.lon]), width, height, pad), [track, width, height, pad]);
  if (pts.length < 2) return null;
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const r = small ? 8 : 11;
  const font = small ? 9.5 : 10.5;
  // Labels sit on whichever side has room.
  const labelSide = (x: number) => (x > width - 70 ? -1 : 1);
  const label = (x: number, y: number, text: string, color: string) => {
    const side = labelSide(x);
    const w = text.length * font * 0.62 + 18;
    const lx = side > 0 ? x + r + 6 : x - r - 6 - w;
    return (
      <G>
        {small ? null : <Rect x={lx} y={y - 11} width={w} height={22} rx={11} fill="rgba(14,13,12,0.8)" />}
        <SvgText x={lx + w / 2} y={y + font * 0.36} textAnchor="middle" fontFamily={RivalFontFamily} fontSize={font} fontWeight="800" fill={color}>{text}</SvgText>
      </G>
    );
  };
  return (
    <View style={[{ width, height, backgroundColor: '#1e1f1e', overflow: 'hidden' }, style]}>
      <Svg width={width} height={height}>
        <Polyline points={line} fill="none" stroke={LINE} strokeWidth={small ? 3.5 : 5} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={sx} cy={sy} r={r} fill="#fff" stroke="#111" strokeWidth={2} />
        <Path d={`M${sx - r * 0.32} ${sy - r * 0.5} L${sx + r * 0.45} ${sy} L${sx - r * 0.32} ${sy + r * 0.5}Z`} fill="#111" />
        {label(sx, sy, 'Start', '#fff')}
        {end === 'now' ? (
          <G>
            <Circle cx={ex} cy={ey} r={13} fill="rgba(255,181,158,0.25)" />
            <Circle cx={ex} cy={ey} r={7} fill={PEACH} stroke="#fff" strokeWidth={2.5} />
            {label(ex, ey + 24, 'Now', PEACH)}
          </G>
        ) : (
          <G>
            <Circle cx={ex} cy={ey} r={r} fill={LINE} stroke="#fff" strokeWidth={1.5} />
            <Flag x={ex} y={ey} r={r} />
            {label(ex, ey, 'Finish', PEACH)}
          </G>
        )}
      </Svg>
    </View>
  );
}

// A small chequered flag on its pole.
function Flag({ x, y, r }: { x: number; y: number; r: number }) {
  const k = r / 8;
  const left = x - 3.5 * k;
  const top = y - 4.5 * k;
  const sq = 1.5 * k;
  return (
    <G>
      <Rect x={left} y={top} width={1.4 * k} height={9 * k} fill="#fff" />
      <Rect x={left + 1.5 * k} y={top} width={6 * k} height={5 * k} fill="#fff" />
      {[0, 1, 2].map((row) => [0, 1].map((col) => (
        <Rect key={`${row}-${col}`} x={left + 1.5 * k + (row % 2 ? 0 : sq) + col * 2 * sq} y={top + row * (5 * k / 3)} width={sq} height={5 * k / 3} fill={LINE} />
      )))}
    </G>
  );
}
