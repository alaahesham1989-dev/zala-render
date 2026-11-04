# zala-render

The cloud video renderer for the ZALA VIP channel (https://www.zalavip.com). Choose an episode and press run.

This repository holds code only. It holds no keys, scripts, audio or video.
Keys are GitHub Actions secrets. Scripts, the picture index, facts and finished videos live in private cloud storage.

## Run

Actions → "ZALA episode" → Run workflow → enter the episode id, for example `ZV-L01`.

Order of work: pictures go from open-license sources straight to storage, each gets a description of what it shows, the story is written from those pictures, then voice, motion, render and checks. Finished files go to `renders/<id>/`.
