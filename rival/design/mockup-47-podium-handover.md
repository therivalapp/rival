# Mockup 47 · Podium (session festive-shannon-67dd2a, branch claude/festive-shannon-67dd2a)

Nothing committed, no app code touched. Files are untracked in that worktree under rival/design/:
- mockup-47-podium-a.png / -b.png / -c.png  (2x stills: Panel 1 Today, Panel 2 Detail)
- mockup-47-podium-a.gif / -b.gif / -c.gif  (arrival animation, 375x600, ~2.3 MB each)
- mockup-47-podium-preview.html            (all three playing, Replay button)
- mockup-47/podium.html + avatar-ricky.png (source; ?v=A|B|C stills, ?v=A&t=ms single frame, ?v=A&sheet=45&step=100 frame sheet)

Directions: A Cast glass, B Brushed metal, C Stone and inlay. Geometry is the real one from home.tsx
(pillarFaces, SHARD_SLOPE, 82px columns, WB_PLATFORM oval). No glows, halos or sweeps in any of them.
All three are plain SVG polygons + linear/radial gradients + clipPath, so they port to react-native-svg as is.
Motion is one timeline as a function of t (rise by translateY behind a clip at the stage line, not scaleY;
count-up; laurel leaves opening base to tip), so it maps to one Reanimated shared value.

Ricky also asked this session for a loading-page logo animation mockup. NOT started here: the sibling
session "Opening animation and motion mockups" (local_806d2f63…) is already on it.

## Update 2026-11-13: Ricky's pick is A4 (mockup only, NOT to be built yet)
- rival/design/mockup-47-podium-a4.png / .gif = Cast glass, soft lines, rounded outer corners, current
  light sweep + leader star burst KEPT (they are deliberate; halo + pillar sparkles stay off as in the app).
- Rounding: faces drawn sharp, the whole pillar clipped to one rounded silhouette (rounding each face
  separately left dark gaps at the corners). Source: rival/design/mockup-47/podium.html?v=G
- Ricky: "I only want it mocked up for now, not built."

## Final pick 2026-11-13: A4 with brighter lines (still mockup only, not to be built yet)
- Ricky confirmed A4 after its lines were made lighter/brighter at the same thin widths.
- Final values (podium.html, SOFT branch): front outline tint .62 @ .8px; top face outline white .5 @ .6px; left edge highlight opacity .95 @ 1px; top front line white .85 @ 1px; rounded silhouette stroke white .45 @ .7px; stage back rim white .2; stage front rim gradient rimS (white .2 → .75 → .2) @ 1px.
- Comparison image: rival/design/mockup-47-podium-a-vs-a4.png (right side = final). Render with podium.html?v=G.
- Keep the light sweep and leader star burst.
