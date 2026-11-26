"""Mastering chain that opens up the owner's muffled cloned voice (24 kHz model output -> 48 kHz).
Use: ffmpeg -i line.wav -af "$(python master.py)" -ar 48000 out.wav"""
exc = 'aexciter=level_in=1:level_out=1:amount=2.5:drive=7:freq=4500:ceil=16000,'
FINAL = ('highpass=f=80,equalizer=f=250:t=q:w=1.0:g=-4,equalizer=f=450:t=q:w=1.2:g=-5,equalizer=f=1800:t=q:w=1.0:g=2,'
         'equalizer=f=3000:t=q:w=1.0:g=5,equalizer=f=5200:t=q:w=1.0:g=2,' + exc.replace('amount=2.5', 'amount=1.8') + 'highshelf=f=8000:g=3,'
         'deesser=i=0.6:m=0.6:f=0.5,equalizer=f=7000:t=q:w=2.0:g=-3,acompressor=threshold=-22dB:ratio=3.5:attack=10:release=140:makeup=3,'
         'atempo=1.03,loudnorm=I=-15:TP=-2:LRA=7')
print(FINAL)
