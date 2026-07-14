# MyFriend

A companion for elderly

![MyFriend](https://growbyte.co/images/robo-companion/myfriend-talking-to-senior.jpg)

In the United States, 16.2 million seniors live completely alone. That's more people than the entire population of several U.S. states combined. Many of them rarely see their family, or not at all, and loneliness becomes part of their daily life.

That's why I'm building [MyFriend](https://growbyte.co/myfriend).

MyFriend has a phone number that you can call any time just to chat, or get some help solving a hard problem. He can also call you on his own initiative to check how you are doing, or to remind you of an important event, like taking your medications or going to the doctor.

More info about this project: https://growbyte.co/myfriend

## How it works:

It's actually very simple. I just use Twilio for the phone API and ElevenLabs for the TTS / STT. Since ElevenLabs has "voice agents" that directly connect to Twilio, this setup requires no coding at all! You can customize the agent in the ElevenLabs UI a lot, you give it a system prompt and you can even create a custom workflow. 

This repo is basically just for the memory management and tools. 

## State of the project:

Right now I'm testing it with as many users as possible to get as much feedback possible, so I can iterate on making the product better and better.

Right now I have ~200 users.

If you wanna test it / know someone who would like to test it, you can call myfriend right now for free using the phone numbers here: https://growbyte.co/myfriend/try