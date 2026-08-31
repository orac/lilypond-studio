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

% Property settings inside lyrics keep their own scopes
\lyricmode {
  \set stanza = "1."
  Once in roy -- al Da -- vid's ci -- ty __
}

% \addlyrics attaches to the preceding music
\relative c' { c4 d e f }
\addlyrics { Now I know my ABC }

% \lyricsto names the voice to follow
\new Lyrics \lyricsto "melody" { Twin -- kle twin -- kle }

% \lyricsto with an explicit lyric mode body
\new Lyrics \lyricsto melody \lyricmode { lit -- tle star }

% \lyrics is the shorthand mode switch
\new Lyrics \lyrics { Do re mi }
