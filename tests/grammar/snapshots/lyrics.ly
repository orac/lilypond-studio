% Basic lyricmode
\lyricmode {
  Hel -- lo world
}

% Nested braces must not end lyricmode early
\lyricmode {
  \repeat unfold 2 { la -- la }
}

% Doubly nested
\lyricmode {
  \repeat unfold 2 { \repeat unfold 2 { la } }
}
