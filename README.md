# evcc compatible heidelberg wallbox with phase switching

This module provides the heidelberg energy control wallbox as a custom evcc charger over HTTP.
The Heidelberg wallbox does not include phase switching by itself. But it is possible to add this with a contactor, 
like described [here](https://github.com/evcc-io/evcc/issues/13162).
This repository is based on a shelly to switch the contactor.  
Note: Right now only shelly1 is implemented!

Best would be if evcc includes this functionality generally like in the mentioned issue (and accepting the "tos"). 
But they don't like people building unsafe things. 
Well, here it is, a software-based p1p3 switcher which can easily be integrated to evcc. Use at your own risk.

When using this module, the heidelberg wallbox is fully working in evcc and additionally:
- no sponsoring token is required
- phase switching is working automatically

I hope this logic could be included in evcc as a general approach for all wallboxes, so it could be more reliable and actively maintained.
Otherwise, people will always write projects like this one.


## running
preferably run as docker and provide the environment variables.

```yaml
services:
  evcc-heidelberg-wallbox-p1p3:
    image: thetruerandom/evcc-heidelberg-wallbox-p1p3:latest
    container_name: evcc-heidelberg-wallbox-p1p3
    ports:
      - "3000:3000"
    environment:
      - SHELLY_HOST=
      - MODBUS_TCP_HOST=
      - MODBUS_TCP_PORT=
    pull_policy: always
    restart: unless-stopped
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 128M
```

## adding to evcc
Remove the charger with `template: heidelberg` if you have it in your evcc.yaml and replace it with this:
```yaml
chargers:
  - name: heidelberg-energy-control-p1p3
    tos: true
    type: custom
    status:
      source: http
      uri: http://localhost:3000/status
    enabled:
      source: http
      uri: http://localhost:3000/enabled
    currents:
      - source: http
        uri: http://localhost:3000/current/1
      - source: http
        uri: http://localhost:3000/current/2
      - source: http
        uri: http://localhost:3000/current/3
    voltages:
      - source: http
        uri: http://localhost:3000/voltage/1
      - source: http
        uri: http://localhost:3000/voltage/2
      - source: http
        uri: http://localhost:3000/voltage/3
    power:
      source: http
      uri: http://localhost:3000/power
    enable:
      source: http
      uri: http://localhost:3000/enable
      method: POST
      headers:
        - Content-Type: application/json
      body: '{"value": "${enable}"}'
    maxcurrent:
      source: http
      uri: http://localhost:3000/maxcurrent
      method: POST
      headers:
        - Content-Type: application/json
      body: '{"value": "${maxcurrent}"}'
    maxcurrentmillis:
      source: http
      uri: http://localhost:3000/maxcurrentmillis
      method: POST
      headers:
        - Content-Type: application/json
      body: '{"value": "${maxcurrentmillis}"}'
    phases1p3p:
      source: http
      uri: http://localhost:3000/phases1p3p
      method: POST
      headers:
        - Content-Type: application/json
      body: '{"value": ${phases}}'
```

The config is a bit verbose, but that's how evcc works; maybe this can be simplified in the future. 


