% Edge cases and potential problem areas

% Breve and longa durations
c\breve d\longa

% Comments
c4 % inline comment
%{ block comment %} d4

% Strings
\header { title = "Quoted \"string\" here" }

% Scheme expressions
#(define foo 42)
\override Staff.TimeSignature.stencil = #point-stencil

% Ensure these don't match as notes
\relative
\clef
\time

% Numbers that aren't durations
\override Stem.length = 6
