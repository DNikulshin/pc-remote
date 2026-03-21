export const WS_EVENTS = {
    // Агент → Сервер
    AGENT_HEARTBEAT: 'agent:heartbeat',
    AGENT_STATUS: 'agent:status',
    AGENT_COMMAND_RESULT: 'agent:command:result',
    AGENT_LOCAL_USERS: 'agent:local:users',
  
    // Сервер → Агент
    SERVER_COMMAND: 'server:command',
    SERVER_SCHEDULE_UPDATE: 'server:schedule:update',
    SERVER_UNBIND: 'server:unbind',       // устройство удалено пользователем
  
    // Агент → Сервер (bind flow)
    AGENT_BIND_REQUEST: 'agent:bind:request',
    SERVER_BIND_SUCCESS: 'server:bind:success',
  } as const
  
  export type WsEvent = (typeof WS_EVENTS)[keyof typeof WS_EVENTS]