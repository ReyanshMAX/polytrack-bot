# Polytrack Copy
Copy of Polytrack, originally made by Kodub.  
This repository WAS for training a Polytrack AI (environment a long time ago. See [polytrack_AI](https://github.com/Hexcein-moonsters/polytrack_AI) for current state).  

1) These serve as a way to keep playable backups/archives of some old Polytrack versions in case Kodub removes static hosting of outdated versions.  
2) This can also be used to when Kodub's VPS isn't running properly and the game can't load (503 service unavailable).  
3) Lastly, it could be used to host Polytrack mirrors on multiple domains. Source code is never used in this project, all files are available on Kodub's current website.  

Disclaimer: The servers won't work due to CORS headers, your scores won't be visible for other players. I am also not associated with Kodub.com.  
See [kodub.com](https://www.kodub.com/apps/polytrack) for the full up to date version.  

# v0.3.1
Replays will not render correctly (if you finish any run your camera will be bugged forever on that track) as this was one of the first mods made: camera following the ghost replay.  
Mod was used to take recordings of the world record to see strategy, as 'Watch' wasn't implemented yet.  

DEVELOPMENT STOPPED

# v0.5.0
New archive. This will sometimes still be maintained by me.  
Modified code, this can render some AI attempts when you click on S1 and on 'Watch' it will specially load these replays.  
Additionally the communication between main and simulation threads is experimentally optimized, about 90% less time wasted on serializing communication data. I saw no interpolation errors when driving, but feel free to give feedback if you do notice a difference.  
Main then reassembles those 90% of steps by copying the last (and only) step sent by the simulation and applying a custom step count to it (using the startStepCount by sim) while not changing any of the actual states data.  
I haven't implemented buffer memory beaming yet