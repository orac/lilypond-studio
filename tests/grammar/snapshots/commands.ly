% Standalone commands (not attached to notes)
\relative c' {
  c4 d e f
}

\time 4/4
\key c \major
\clef treble

% Repeat abbreviations (LilyPond 2.26): \% for \repeat percent, \* for \repeat unfold
\% 2 { c4 d e f }
\* 2 { c4 d e f }

% Variable declarations
melody = { c4 d e f }

% Markup
\markup { Hello world }
\markup \bold { Bold text }

% Lyrics
\lyricmode {
  Hel -- lo world
}
