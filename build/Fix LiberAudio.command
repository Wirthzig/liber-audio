#!/bin/bash
# This script removes the quarantine flag from LiberAudio so macOS will allow it to run.

osascript -e 'do shell script "xattr -cr /Applications/LiberAudio.app" with administrator privileges'

if [ $? -eq 0 ]; then
  osascript -e 'display dialog "Done! You can now open LiberAudio normally." buttons {"OK"} default button "OK" with title "LiberAudio Fix"'
else
  osascript -e 'display dialog "Something went wrong. Please try running the command manually:\n\nsudo xattr -cr /Applications/LiberAudio.app" buttons {"OK"} default button "OK" with title "LiberAudio Fix" with icon stop'
fi
