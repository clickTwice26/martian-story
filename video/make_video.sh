#!/bin/bash
# Build the Space Apps demo video: team title card, then the gameplay
# recording, under the ElevenLabs narration. Output: video/martian_story_demo.mp4
#
#   ./video/make_video.sh voice.mp3 recording.mov [skip_seconds] [title_seconds]
#
#   skip_seconds   how much of the recording's start to cut (loading screen etc.), default 0
#   title_seconds  how long the team card stays up, default 13 (matches the intro lines)
#   crop           optional w:h:x:y of the game area inside the recording (drops browser chrome)
set -euo pipefail
cd "$(dirname "$0")"
VOICE="$1"; REC="$2"; SKIP="${3:-0}"; TITLE="${4:-13}"; CROP="${5:-}"
CROPF=""; [ -n "$CROP" ] && CROPF="crop=$CROP,"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VOICE")
TOTAL=$(python3 -c "print(min(239.0, float('$DUR') + 1.0))")   # Space Apps limit: 240 s
GAME=$(python3 -c "print(max(1.0, $TOTAL - $TITLE))")
echo "voice ${DUR}s -> video ${TOTAL}s (title ${TITLE}s + gameplay ${GAME}s)"

# 1. title card with a slow push-in and fades
ffmpeg -y -loglevel error -loop 1 -framerate 30 -t "$TITLE" -i title.png \
  -vf "scale=3840:-2,zoompan=z='min(1.0+0.0007*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,fade=in:0:15,fade=out:st=$(python3 -c "print($TITLE-0.6)"):d=0.6,format=yuv420p" \
  -c:v libx264 -preset fast -crf 18 title_clip.mp4

# 2. gameplay, trimmed and scaled to 1080p
ffmpeg -y -loglevel error -ss "$SKIP" -t "$GAME" -i "$REC" \
  -vf "${CROPF}scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,fade=in:0:15,fade=out:st=$(python3 -c "print($GAME-1.2)"):d=1.2,format=yuv420p" \
  -an -c:v libx264 -preset fast -crf 19 game_clip.mp4

# 3. join and lay the narration on top
printf "file 'title_clip.mp4'\nfile 'game_clip.mp4'\n" > clips.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i clips.txt -i "$VOICE" \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -af "apad" -t "$TOTAL" -movflags +faststart \
  martian_story_demo.mp4
rm -f title_clip.mp4 game_clip.mp4 clips.txt
echo "done: $(pwd)/martian_story_demo.mp4"
ffprobe -v error -show_entries format=duration -of csv=p=0 martian_story_demo.mp4
