import type {Understanding} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import {readConfiguration} from '@/services/video/config/environment';
import {unknownMediaStopMessage} from '@/services/video/media/stop-state';
import {deliveryGap} from '@/services/video/quality/delivery';
export function previewAction(control:ProjectControl,understanding:Understanding){
 const config=readConfiguration();
 const disabledReason=Object.keys(control.unresolvedMediaStops||{}).length?unknownMediaStopMessage:!config.generationEnabled?'制作服务尚未开放，资料和消息会保留。':config.missing.length?'制作服务尚未配置完成，资料和消息会保留。':
  control.activeConversation||control.activeProduction?'正在处理当前任务，请稍等。':control.inputPending?'资料还在读取，请稍等。':
  !understanding.subject.trim()||!understanding.preferences.styleSlug||understanding.unresolvedConflictIds.length?'继续聊聊内容，选好画风后就能先看效果。':
  // The worker would reject this profile; say so before the user starts a doomed job.
  deliveryGap(understanding)?deliveryGap(understanding)!.message:
  Object.keys(control.previewOutcomes||{}).length>=16?'有任务正在恢复，请稍后再试。':
  understanding.assetUses.some(use=>use.required&&!control.assets.some(a=>a.id===use.assetId&&a.status==='ready'))?'请先补齐需要的资料。':
  !['collecting','preview_ready','ready','attention','cancelled'].includes(control.phase)?'正在准备效果，请稍等。':undefined;
 return{kind:'prepare_preview',enabled:!disabledReason,...(disabledReason?{disabledReason}:{})};
}

import type {PreviewBundle} from './bundle';
/** Presentation of the same readiness fences enforced again by approvePreview.
 * Old full-certification previews remain explicitly unavailable for MVP. */
export function approvalAction(control:ProjectControl,preview:PreviewBundle,config:Pick<ReturnType<typeof readConfiguration>,'generationEnabled'|'missing'>=readConfiguration(),now=Date.now()){
 const disabledReason=Object.keys(control.unresolvedMediaStops||{}).length?unknownMediaStopMessage:!config.generationEnabled?'制作服务尚未开放。':config.missing.length?'制作服务尚未配置完成。':
  control.activeConversation||control.activeProduction||control.inputPending?'正在处理当前任务，请稍等。':
  control.phase!=='preview_ready'||control.previewState!=='ready'||control.currentPreviewId!==preview.previewId||control.briefVersion!==preview.briefVersion||Date.parse(preview.expiresAt)<=now?'效果已经变化，请先看新效果。':
  !preview.renderInputs.qualityPolicyRef?'这个旧效果使用完整验收策略，请先生成新的 MVP 效果。':undefined;
 return{kind:'approve_preview',enabled:!disabledReason,...(disabledReason?{disabledReason}:{})};
}
