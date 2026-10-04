export function npcChannelLabel(channel?: string): string {
  return channel === 'online' ? '电脑私聊' : channel === 'in-person' ? '面对面' : '在场';
}
