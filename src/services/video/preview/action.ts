import type {Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {readConfiguration} from '@/services/video/config/environment';
import {unknownMediaStopMessage} from '@/services/video/media/stop-state';
export function previewAction(control:ProjectControl,understanding:Understanding){
 const config=readConfiguration();
 const disabledReason=Object.keys(control.unresolvedMediaStops||{}).length?unknownMediaStopMessage:!config.generationEnabled?'制作服务尚未开放，资料和消息会保留。':config.missing.length?'制作服务尚未配置完成，资料和消息会保留。':
  control.activeConversation||control.activeProduction?'正在处理当前任务，请稍等。':control.inputPending?'资料还在读取，请稍等。':
  !understanding.subject.trim()||!understanding.preferences.styleSlug||understanding.unresolvedConflictIds.length?'继续聊聊内容，选好画风后就能先看效果。':
  Object.keys(control.previewOutcomes||{}).length>=16?'有任务正在恢复，请稍后再试。':
  understanding.assetUses.some(use=>use.required&&!control.assets.some(a=>a.id===use.assetId&&a.status==='ready'))?'请先补齐需要的资料。':
  !['collecting','preview_ready','ready','attention','cancelled'].includes(control.phase)?'正在准备效果，请稍等。':undefined;
 return{kind:'prepare_preview',enabled:!disabledReason,...(disabledReason?{disabledReason}:{})};
}
