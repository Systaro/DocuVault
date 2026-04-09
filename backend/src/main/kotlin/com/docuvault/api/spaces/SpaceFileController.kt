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
  var markers={},clickEnabled=false;
  var style=document.createElement('style');
  style.textContent='.dv-pin{position:absolute;width:28px;height:28px;border-radius:50% 50% 50% 0;background:#f59e0b;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;transform:translate(-50%,-100%) rotate(-45deg);transition:transform .15s,background .15s;pointer-events:auto}.dv-pin:hover{transform:translate(-50%,-100%) rotate(-45deg) scale(1.15)}.dv-pin.resolved{background:#10b981}.dv-pin-num{transform:rotate(45deg);font-size:12px;font-weight:600;color:#fff;user-select:none;font-family:system-ui}';
  document.head.appendChild(style);
  window.addEventListener('message',function(e){
    if(!e.data||e.data.source!=='docuvault-annotations')return;
    if(e.data.type==='render-markers'){
      Object.values(markers).forEach(function(m){m.remove()});markers={};
      (e.data.annotations||[]).forEach(function(a){
        var el=null;
        if(a.elementId){el=document.getElementById(a.elementId)}
        if(!el&&a.selector){try{el=document.querySelector(a.selector)}catch(ex){}}
        var pin=document.createElement('div');pin.className='dv-pin'+(a.resolved?' resolved':'');
        if(el){
          var r=el.getBoundingClientRect();var br=document.body.getBoundingClientRect();
          pin.style.left=(r.left-br.left+r.width*(a.offsetX||0)/100)+'px';
          pin.style.top=(r.top-br.top+r.height*(a.offsetY||0)/100+window.scrollY)+'px';
        }else{
          pin.style.left=a.xPercent+'%';pin.style.top=a.yPercent+'%';
        }
        var num=document.createElement('span');num.className='dv-pin-num';num.textContent=a.index;
        pin.appendChild(num);
        pin.addEventListener('click',function(ev){ev.stopPropagation();
          window.parent.postMessage({source:'docuvault-annotations',type:'marker-click',id:a.id},'*')});
        document.body.appendChild(pin);markers[a.id]=pin;
      });
    }
    if(e.data.type==='enable-click-capture'&&!clickEnabled){
      clickEnabled=true;
      document.addEventListener('click',function(ev){
        if(ev.target.closest('.dv-pin'))return;
        var br=document.body.getBoundingClientRect();
        var xP=((ev.clientX-br.left)/br.width)*100;
        var yP=((ev.clientY+window.scrollY)/document.body.scrollHeight)*100;
        var t=ev.target.closest('[id]');
        var sel=null;try{
          var p=ev.target;var parts=[];while(p&&p!==document.body){
            var tag=p.tagName.toLowerCase();if(p.id){parts.unshift('#'+p.id);break}
            var idx=1;var s=p;while(s.previousElementSibling){s=s.previousElementSibling;if(s.tagName===p.tagName)idx++}
            parts.unshift(tag+':nth-of-type('+idx+')');p=p.parentElement}
          if(parts.length)sel=parts.join('>')
        }catch(ex){}
        window.parent.postMessage({source:'docuvault-annotations',type:'click-position',
          xPercent:xP,yPercent:yP,elementId:t?t.id:null,selector:sel},'*');
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
