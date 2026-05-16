package com.docuvault.api.spaces

import com.docuvault.infrastructure.repository.SpaceRepository
import com.docuvault.infrastructure.repository.UserRepository
import com.docuvault.service.PermissionService
import com.docuvault.service.git.GitService
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.core.userdetails.UserDetails
import org.springframework.web.bind.annotation.*
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.util.*
import java.util.concurrent.TimeUnit

@RestController
@RequestMapping("/spaces/{spaceId}/files")
class SpaceFileController(
    private val spaceRepository: SpaceRepository,
    private val userRepository: UserRepository,
    private val permissionService: PermissionService,
    private val gitService: GitService
) {
    @GetMapping("/**")
    fun getFile(
        @PathVariable spaceId: UUID,
        @AuthenticationPrincipal userDetails: UserDetails,
        request: HttpServletRequest
    ): ResponseEntity<ByteArray> {
        val user = userRepository.findByEmail(userDetails.username)
            ?: return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build()

        val space = spaceRepository.findById(spaceId).orElse(null)
            ?: return ResponseEntity.notFound().build()

        if (!permissionService.hasAccess(user.id!!, space.id!!, user.role)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).build()
        }

        val basePath = "/api/spaces/$spaceId/files/"
        val rawPath = if (request.requestURI.startsWith(basePath)) {
            request.requestURI.substring(basePath.length)
        } else {
            return ResponseEntity.badRequest().build()
        }
        val filePath = URLDecoder.decode(rawPath, StandardCharsets.UTF_8)

        val repoPath = gitService.getRepoPath(spaceId)
        val resolved = repoPath.resolve(filePath).normalize()

        // Path traversal protection
        if (!resolved.startsWith(repoPath.normalize())) {
            return ResponseEntity.badRequest().build()
        }

        if (!Files.exists(resolved) || !Files.isRegularFile(resolved)) {
            return ResponseEntity.notFound().build()
        }

        val contentType = Files.probeContentType(resolved) ?: "application/octet-stream"
        val extension = filePath.substringAfterLast('.', "").lowercase()
        val isHtml = extension in listOf("html", "htm")

        // For HTML files, inject the annotation bridge script
        if (isHtml) {
            val html = Files.readString(resolved)
            val injected = injectAnnotationBridge(html, "/api/spaces/$spaceId/files/${filePath.substringBeforeLast('/')}/")
            return ResponseEntity.ok()
                .contentType(MediaType.TEXT_HTML)
                .cacheControl(CacheControl.noCache())
                .body(injected.toByteArray(Charsets.UTF_8))
        }

        val bytes = Files.readAllBytes(resolved)

        val cachePolicy = if (contentType.startsWith("image/") || contentType.startsWith("font/")) {
            CacheControl.maxAge(1, TimeUnit.HOURS).cachePublic()
        } else {
            CacheControl.noCache()
        }

        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .cacheControl(cachePolicy)
            .body(bytes)
    }

    private fun injectAnnotationBridge(html: String, baseHref: String): String {
        val baseTag = "<base href=\"$baseHref\">"
        val bridgeScript = """<script>
(function(){
  var markers={},clickEnabled=false,commentMode=false;
  var style=document.createElement('style');
  style.textContent='.dv-pin{position:absolute;width:28px;height:28px;border-radius:50% 50% 50% 0;background:#f59e0b;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;transform:translate(-50%,-100%) rotate(-45deg);transition:transform .15s,background .15s;pointer-events:auto}.dv-pin:hover{transform:translate(-50%,-100%) rotate(-45deg) scale(1.15)}.dv-pin.resolved{background:#10b981}.dv-pin-num{transform:rotate(45deg);font-size:12px;font-weight:600;color:#fff;user-select:none;font-family:system-ui}.dv-placement-dot{position:absolute;width:14px;height:14px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);transform:translate(-50%,-50%);z-index:9998;pointer-events:none;animation:dvpulse 1.5s ease-in-out infinite}@keyframes dvpulse{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.25),0 0 0 0 rgba(245,158,11,.4)}50%{box-shadow:0 2px 8px rgba(0,0,0,.25),0 0 0 6px rgba(245,158,11,0)}}';
  document.head.appendChild(style);
  window.addEventListener('message',function(e){
    if(!e.data||e.data.source!=='docuvault-annotations')return;
    if(e.data.type==='render-markers'){
      Object.values(markers).forEach(function(m){m.remove()});markers={};
      var d=document.getElementById('__dv_placement');if(d)d.remove();
      (e.data.annotations||[]).forEach(function(a){
        var el=null;
        if(a.elementId){el=document.getElementById(a.elementId)}
        if(!el&&a.selector){try{el=document.querySelector(a.selector)}catch(ex){}}
        var pin=document.createElement('div');pin.className='dv-pin'+(a.resolved?' resolved':'');
        if(el){
          var r=el.getBoundingClientRect();
          // r.* is viewport-relative; add scroll to get document-absolute (body's offsetParent is the initial CB)
          pin.style.left=(r.left+window.scrollX+r.width*(a.offsetX||0)/100)+'px';
          pin.style.top=(r.top+window.scrollY+r.height*(a.offsetY||0)/100)+'px';
        }else{
          // Fallback: convert stored percentages back to absolute pixel coords against the full scrollable body
          pin.style.left=(a.xPercent/100*document.documentElement.scrollWidth)+'px';
          pin.style.top=(a.yPercent/100*document.documentElement.scrollHeight)+'px';
        }
        var num=document.createElement('span');num.className='dv-pin-num';num.textContent=a.index;
        pin.appendChild(num);
        pin.addEventListener('click',function(ev){ev.stopPropagation();
          window.parent.postMessage({source:'docuvault-annotations',type:'marker-click',id:a.id},'*')});
        document.body.appendChild(pin);markers[a.id]=pin;
      });
    }
    if(e.data.type==='clear-placement-dot'){
      var d=document.getElementById('__dv_placement');if(d)d.remove();
    }
    if(e.data.type==='scroll-to-marker'){
      var pin=markers[e.data.id];
      if(pin){
        var top=parseFloat(pin.style.top)||0;
        window.scrollTo({top:Math.max(0,top-window.innerHeight/3),behavior:'smooth'});
      }
    }
    if(e.data.type==='set-comment-mode'){
      commentMode=!!e.data.on;
      if(!commentMode){var dx=document.getElementById('__dv_placement');if(dx)dx.remove();}
    }
    if(e.data.type==='enable-click-capture'&&!clickEnabled){
      clickEnabled=true;
      document.addEventListener('click',function(ev){
        if(!commentMode)return;
        if(ev.target.closest('.dv-pin'))return;
        var sw=document.documentElement.scrollWidth,sh=document.documentElement.scrollHeight;
        // Absolute document-space click coords
        var ax=ev.clientX+window.scrollX,ay=ev.clientY+window.scrollY;
        var xP=(ax/sw)*100,yP=(ay/sh)*100;
        // Element-anchored offset (where inside the element was clicked, as % of its size)
        var anchorEl=ev.target.closest('[id]')||ev.target;
        var er=anchorEl.getBoundingClientRect();
        var oX=er.width>0?((ev.clientX-er.left)/er.width)*100:0;
        var oY=er.height>0?((ev.clientY-er.top)/er.height)*100:0;
        var sel=null;try{
          var p=ev.target;var parts=[];while(p&&p!==document.body){
            var tag=p.tagName.toLowerCase();if(p.id){parts.unshift('#'+p.id);break}
            var idx=1;var s=p;while(s.previousElementSibling){s=s.previousElementSibling;if(s.tagName===p.tagName)idx++}
            parts.unshift(tag+':nth-of-type('+idx+')');p=p.parentElement}
          if(parts.length)sel=parts.join('>')
        }catch(ex){}
        var dot=document.getElementById('__dv_placement');if(dot)dot.remove();
        dot=document.createElement('div');dot.id='__dv_placement';dot.className='dv-placement-dot';
        dot.style.left=ax+'px';dot.style.top=ay+'px';
        document.body.appendChild(dot);
        window.parent.postMessage({source:'docuvault-annotations',type:'click-position',
          xPercent:xP,yPercent:yP,offsetX:oX,offsetY:oY,
          clientX:ev.clientX,clientY:ev.clientY,
          elementId:anchorEl.id||null,selector:sel},'*');
      });
    }
  });
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){window.parent.postMessage({source:'docuvault-annotations',type:'ready'},'*')})}
  else{window.parent.postMessage({source:'docuvault-annotations',type:'ready'},'*')}
})();
</script>"""
        val headIndex = html.indexOf("<head>", ignoreCase = true)
        if (headIndex >= 0) {
            val insertAt = headIndex + "<head>".length
            return html.substring(0, insertAt) + baseTag + html.substring(insertAt) + bridgeScript
        }
        return baseTag + html + bridgeScript
    }
}
