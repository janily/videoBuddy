import{it,expect}from'vitest';
import{listStyles,getStyle,searchStyles}from'@/services/video/styles/registry';
import{loadStageKnowledge}from'@/services/video/styles/knowledge-loader';
it('AT-025 all 43 unique identities and nine categories are reachable; unknown slug cannot become Swiss',()=>{
 const styles=listStyles();expect(styles).toHaveLength(43);expect(new Set(styles.map(s=>s.id)).size).toBe(43);expect(new Set(styles.map(s=>s.categoryZh)).size).toBe(9);
 expect(()=>getStyle('not-a-style')).toThrow('CAPABILITY_UNAVAILABLE');
 for(const s of styles)expect(getStyle(s.id).id).toBe(s.id);
});
it.each([['HD-2D','hd-2d'],['水墨','ink-wash'],['ink-wash','ink-wash']])('AT-076 search %s preserves original slug',(query,id)=>expect(searchStyles(query).map(s=>s.id)).toContain(id));
it('AT-026 style rules available before Treatment, demo cannot be read',async()=>{
 const knowledge=await loadStageKnowledge('glass-product','style');expect(knowledge.rules.length).toBeGreaterThan(100);expect(knowledge.sha256).toMatch(/^[a-f0-9]{64}$/);
 await expect(loadStageKnowledge('glass-product','demo')).rejects.toThrow('TREATMENT_REQUIRED');
 await expect(loadStageKnowledge('../secrets','style')).rejects.toThrow('CAPABILITY_UNAVAILABLE');
});
it('untested profiles remain unavailable rather than falsely advertised',()=>{
 for(const s of listStyles()){expect(s.supportedProfiles).toEqual([]);expect(s.deliveryStatus).toBe('not_run')}
});

import {searchStyleFits,styleFits} from '@/services/video/styles/recommendations';
it('searches uses, mood, keywords and bilingual identities with a distinct sample palette for all styles',()=>{
 expect(searchStyleFits('国风').map(style=>style.id)).toContain('ink-wash');
 expect(searchStyleFits('黑客').map(style=>style.id)).toContain('ascii-crt');
 expect(searchStyleFits('Watercolor').map(style=>style.id)).toContain('watercolor');
 expect(searchStyleFits('荒诞').map(style=>style.id)).toContain('scifi-toon');
 expect(searchStyleFits('没有这种风格')).toEqual([]);
 for(const style of listStyles())expect(styleFits[style.id].swatch).toHaveLength(3);
});
