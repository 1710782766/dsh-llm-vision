/**
 * Vision-model prompts ported verbatim from llm_vision (MIT).
 * The critical perspective is the field-tested lesson that vision models
 * rationalize rendering bugs; the inspection instruction is what makes
 * screenshot QA reliable. Changing these strings changes model output style.
 * @module dsh-llm-vision/prompts
 */

/** Critical inspection perspective: objective description + actively report anomalies + fact vs. guess. */
export const DEFAULT_CRITICAL_DESCRIBE_PROMPT =
  '请以审视的角度仔细观察这张图片并如实回答：'
  + '1) 客观描述看到的内容（文字、元素、布局、配色）；'
  + '2) 主动指出任何异常：文字重叠、遮挡、错位、换行异常、元素缺失或显示错误；'
  + '3) 区分【事实】与【推测】，不确定就明说看不到，绝不编造；'
  + '4) 不要为异常寻找合理化解释——异常就是异常，如实报告。'

/** Normal perspective: natural description for everyday look-at-this-image questions. */
export const DEFAULT_NORMAL_DESCRIBE_PROMPT =
  '请自然描述这张图片的内容（主体、场景、文字、布局、配色等），'
  + '并回答针对图片的问题；看不清或不确定的地方如实说明，不要编造。'

/** OCR perspective: verbatim extraction only, mark illegible parts. */
export const DEFAULT_OCR_PROMPT =
  '请提取图片中的全部文字；只提取真实看到的内容，不补全、不猜测缺失文字；'
  + '字迹不清晰或无法辨认的位置请注明。'
