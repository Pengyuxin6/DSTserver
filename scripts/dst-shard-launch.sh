#!/bin/bash
SHARD="$1"; SCREEN_SESS="$2"; BIN="$3"; CWD="$4"; CLUSTER="$5"
shift 5
EXTRA_ARGS="$@"

systemd-run --unit="dst-${SHARD,,}" --slice=dst.slice --service-type=simple \
  -p User=steam \
  -p Group=steam \
  -p WorkingDirectory="$CWD" \
  -- /bin/bash -c "screen -dmS ${SCREEN_SESS} ${BIN} -cluster ${CLUSTER} -shard ${SHARD} ${EXTRA_ARGS}; while screen -list ${SCREEN_SESS} 2>/dev/null | grep -q ${SCREEN_SESS}; do sleep 5; done" 2>/dev/null
exit $?
