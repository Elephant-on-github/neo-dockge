<div align="center" width="100%">
    <img src="./frontend/public/icon.svg" width="128" alt="" />
</div>

# neo-dockge

> Maintained fork of [Dockge](https://github.com/louislam/dockge) by Louis Lam. Original work is © Louis Lam under the MIT License.

A fancy, easy-to-use and reactive self-hosted docker compose.yaml stack-oriented manager.

[![GitHub release](https://img.shields.io/github/v/release/Elephant-on-github/neo-dockge?logo=github)](https://github.com/Elephant-on-github/neo-dockge/releases/latest) [![CI](https://img.shields.io/github/actions/workflow/status/Elephant-on-github/neo-dockge/ci.yml?branch=master&logo=github)](https://github.com/Elephant-on-github/neo-dockge/actions/workflows/ci.yml) [![GitHub last commit (branch)](https://img.shields.io/github/last-commit/Elephant-on-github/neo-dockge/master?logo=github)](https://github.com/Elephant-on-github/neo-dockge/commits/master/)

<img src="https://github.com/louislam/dockge/assets/1336778/26a583e1-ecb1-4a8d-aedf-76157d714ad7" width="900" alt="" />

View Video: https://youtu.be/AWAlOQeNpgU?t=48

## ⭐ Features

- 🧑‍💼 Manage your `compose.yaml` files
  - Create/Edit/Start/Stop/Restart/Delete
  - Update Docker Images
- ⌨️ Interactive Editor for `compose.yaml`
- 🦦 Interactive Web Terminal
- 🕷️ (1.4.0 🆕) Multiple agents support - You can manage multiple stacks from different Docker hosts in one single interface
- 🏪 Convert `docker run ...` commands into `compose.yaml`
- 📙 File based structure - neo-dockge won't kidnap your compose files, they are stored on your drive as usual. You can interact with them using normal `docker compose` commands

<img src="https://github.com/louislam/dockge/assets/1336778/cc071864-592e-4909-b73a-343a57494002" width=300 />

- 🚄 Reactive - Everything is just responsive. Progress (Pull/Up/Down) and terminal output are in real-time
- 🐣 Easy-to-use & fancy UI - If you love Uptime Kuma's UI/UX, you will love this one too

![](https://github.com/louislam/dockge/assets/1336778/89fc1023-b069-42c0-a01c-918c495f1a6a)

## 🔧 How to Install

Requirements:
- [Docker](https://docs.docker.com/engine/install/) 20+ / Podman
- (Podman only) podman-docker (Debian: `apt install podman-docker`)
- OS:
  - Major Linux distros that can run Docker/Podman such as:
     - ✅ Ubuntu
     - ✅ Debian (Bullseye or newer)
     - ✅ Raspbian (Bullseye or newer)
     - ✅ CentOS
     - ✅ Fedora
     - ✅ ArchLinux
  - ❌ Debian/Raspbian Buster or lower is not supported
  - ❌ Windows (Will be supported later)
- Arch: arm64, amd64 (a.k.a x86_64)

### Basic

- Default Stacks Directory: `/opt/stacks`
- Default Port: 5001

```
# Create directories that store your stacks and stores neo-dockge's stack
mkdir -p /opt/stacks /opt/neo-dockge
cd /opt/neo-dockge

# Download the compose.yaml
curl https://raw.githubusercontent.com/Elephant-on-github/neo-dockge/master/compose.yaml --output compose.yaml

# Start the server
docker compose up -d

# If you are using docker-compose V1 or Podman
# docker-compose up -d
```

neo-dockge is now running on http://localhost:5001

### Advanced

If you want to store your stacks in another directory, edit your compose.yaml and change **both** the stacks volume mount and `DOCKGE_STACKS_DIR` — the two paths must match (see the warning in the compose example below).

Also, add the `PUID` and `PGID` section below to your compose `environment:` section to set stack ownership, otherwise default is `root`

```
      # Both PUID and PGID must be set for it to do anything
      - PUID=1000 # Set the stack file/dir ownership to this user
      - PGID=1000 # Set the stack file/dir ownership to this group
```

### -OR-
Copy and paste your compose from the following:

If you want to store your stacks in another directory, you can change the `DOCKGE_STACKS_DIR` environment variable and volumes.

compose:
```
services:
  neo-dockge:
    image: ghcr.io/elephant-on-github/neo-dockge:1
    restart: unless-stopped
    ports:
      # Host Port:Container Port
      - 5001:5001
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
        
      # If you want to use private registries, you need to share the auth file with neo-dockge:
      # - /root/.docker/:/root/.docker

      # Stacks Directory
      # Your stacks directory in the host (The paths inside container must be the same as the host)
      # ⚠️ If you did it wrong, your data could end up be written into a wrong path.
      # ✔️ CORRECT EXAMPLE: - /my-stacks:/my-stacks (Both paths match)
      # ❌ WRONG EXAMPLE: - /docker:/my-stacks (Both paths do not match)
      - /opt/stacks:/opt/stacks
    environment:
      # Tell neo-dockge where your stacks directory is
      - DOCKGE_STACKS_DIR=/opt/stacks
      # Both PUID and PGID must be set for it to do anything
      - PUID=1000 # Set the stack file/dir ownership to this user
      - PGID=1000 # Set the stack file/dir ownership to this group
```

## How to Update

```bash
cd /opt/neo-dockge
docker compose pull && docker compose up -d
```

## Screenshots

![](https://github.com/louislam/dockge/assets/1336778/e7ff0222-af2e-405c-b533-4eab04791b40)


![](https://github.com/louislam/dockge/assets/1336778/7139e88c-77ed-4d45-96e3-00b66d36d871)

![](https://github.com/louislam/dockge/assets/1336778/f019944c-0e87-405b-a1b8-625b35de1eeb)

![](https://github.com/louislam/dockge/assets/1336778/a4478d23-b1c4-4991-8768-1a7cad3472e3)


## Motivations (inherited from the original Dockge)

- I have been using Portainer for some time, but for the stack management, I am sometimes not satisfied with it. For example, sometimes when I try to deploy a stack, the loading icon keeps spinning for a few minutes without progress. And sometimes error messages are not clear.
- Try to develop with ES Module + TypeScript

If you love this project, please consider giving it a ⭐.


## 🗣️ Community and Contribution

### Bug Report
https://github.com/Elephant-on-github/neo-dockge/issues

### Ask for Help / Discussions
The upstream community is active at https://github.com/louislam/dockge/discussions

### Translation
If you want to translate neo-dockge into your language, please read the [Translation Guide](https://github.com/Elephant-on-github/neo-dockge/blob/master/frontend/src/lang/README.md)

### Create a Pull Request

Be sure to read the [guide](https://github.com/Elephant-on-github/neo-dockge/blob/master/CONTRIBUTING.md). Fixes and parity with upstream are most welcome; larger divergences should be discussed first.

## FAQ

#### "Dockge"?

neo-dockge's name honours the original project — here is how Louis Lam named it:

"Dockge" is a coinage word which is created by myself. I originally hoped it sounds like `Dodge`, but apparently many people called it `Dockage`, it is also acceptable.

The naming idea came from Twitch emotes like `sadge`, `bedge` or `wokege`. They all end in `-ge`.

#### Can I manage a single container without `compose.yaml`?

The main objective of neo-dockge is to try to use the docker `compose.yaml` for everything. If you want to manage a single container, you can just use Portainer or Docker CLI.

#### Can I manage existing stacks?

Yes, you can. However, you need to move your compose file into the stacks directory:

1. Stop your stack
2. Move your compose file into `/opt/stacks/<stackName>/compose.yaml`
3. In neo-dockge, click the " Scan Stacks Folder" button in the top-right corner's dropdown menu
4. Now you should see your stack in the list

#### Is neo-dockge a Portainer replacement?

Yes or no. Portainer provides a lot of Docker features. While neo-dockge is currently only focusing on docker-compose with a better user interface and better user experience.

If you want to manage your container with docker-compose only, the answer may be yes.

If you still need to manage something like docker networks, single containers, the answer may be no.

#### Can I install both neo-dockge and Portainer?

Yes, you can.

## Others

neo-dockge is built on top of [Compose V2](https://docs.docker.com/compose/migrate/). `compose.yaml`  also known as `docker-compose.yml`.
