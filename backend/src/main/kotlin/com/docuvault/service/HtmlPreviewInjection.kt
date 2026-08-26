package com.docuvault.service

import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * The chrome injected into an HTML document before it is handed to a preview
 * iframe: a `<base>` so its relative assets resolve, a fix for in-page anchor
 * links that the `<base>` would otherwise break, and the comment bridge that
 * lets the surrounding app place pins inside the frame.
 *
 * This lived twice — once in `SpaceFileController`, once in
 * `PublicShareController` — as two hand-maintained copies of ~90 lines of
 * inline JavaScript. They had already drifted: only the public one carried the
 * anchor-link fix, so the same document behaved differently depending on
 * whether you were logged in. One copy now, used by both.
 */
object HtmlPreviewInjection {

    /**
     * Wrap [html] for preview. [baseHref] is the directory the document's
     * relative links resolve against.
     */
    fun inject(html: String, baseHref: String): String {
        val baseTag = """<base href="${baseHref.replace("\"", "%22")}">"""
        val scripts = ANCHOR_FIX_SCRIPT + ANNOTATION_BRIDGE_SCRIPT

        val headIndex = html.indexOf("<head>", ignoreCase = true)
        if (headIndex >= 0) {
            val insertAt = headIndex + "<head>".length
            return html.substring(0, insertAt) + baseTag + html.substring(insertAt) + scripts
        }
        // No <head> of its own — the base tag still has to come before anything
        // that might reference a relative URL.
        return baseTag + html + scripts
    }

    /**
     * The `<base href>` for a document at [filePath] (relative to the space
     * repository) served under [filesEndpoint], the endpoint that resolves
     * paths against the repository root.
     *
     * The document's own directory is what relative references hang off, so a
     * `../assets/styles.css` one folder up resolves to a real repository path
     * instead of walking off the endpoint. A file at the repository root has no
     * directory — the base is then the endpoint itself.
     */
    fun baseHref(filesEndpoint: String, filePath: String): String {
        val directory = filePath.replace('\\', '/').substringBeforeLast('/', "")
        val prefix = filesEndpoint.trimEnd('/')
        if (directory.isEmpty()) return "$prefix/"
        val encoded = directory.split('/').joinToString("/") { segment ->
            URLEncoder.encode(segment, StandardCharsets.UTF_8).replace("+", "%20")
        }
        return "$prefix/$encoded/"
    }

    /**
     * `<base>` makes a bare `#section` link resolve against the base URL instead
     * of the current document, which navigates away rather than scrolling. Catch
     * those clicks and scroll in place.
     */
    private val ANCHOR_FIX_SCRIPT = """<script>document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a)return;var id=a.getAttribute('href').substring(1);var t=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(t){e.preventDefault();t.scrollIntoView({behavior:'smooth'})}});</script>"""

    /**
     * The comment bridge. Runs inside the previewed document, which may itself
     * contain untrusted scripts — that is a deliberate product decision, see
     * SECURITY.md — so messages are addressed to the parent's real origin rather
     * than to '*', and the parent checks the origin on the way back.
     */
    private val ANNOTATION_BRIDGE_SCRIPT = """<script>
(function(){
  var markers={},clickEnabled=false,commentMode=false;
  var PARENT_ORIGIN=window.location.origin;
  function post(message){try{window.parent.postMessage(message,PARENT_ORIGIN)}catch(e){}}
  var style=document.createElement('style');
  style.textContent='.dv-pin{position:absolute;width:28px;height:28px;border-radius:50% 50% 50% 0;background:#f59e0b;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9999;transform:translate(-50%,-100%) rotate(-45deg);transition:transform .15s,background .15s;pointer-events:auto}.dv-pin:hover{transform:translate(-50%,-100%) rotate(-45deg) scale(1.15)}.dv-pin.resolved{background:#10b981}.dv-pin.shifted{box-shadow:0 2px 8px rgba(0,0,0,.2),0 0 0 3px rgba(180,125,42,.55)}.dv-pin-num{transform:rotate(45deg);font-size:12px;font-weight:600;color:#fff;user-select:none;font-family:system-ui}.dv-placement-dot{position:absolute;width:14px;height:14px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);transform:translate(-50%,-50%);z-index:9998;pointer-events:none;animation:dvpulse 1.5s ease-in-out infinite}@keyframes dvpulse{0%,100%{box-shadow:0 2px 8px rgba(0,0,0,.25),0 0 0 0 rgba(245,158,11,.4)}50%{box-shadow:0 2px 8px rgba(0,0,0,.25),0 0 0 6px rgba(245,158,11,0)}}';
  document.head.appendChild(style);
  // Text of the whole document, whitespace-collapsed — the same normalisation
  // the parent's anchoring uses, so a quote recorded there is findable here.
  function docText(){return (document.body?document.body.innerText:'').replace(/\s+/g,' ').trim()}
  function findQuote(quote){
    if(!quote)return null;
    var text=docText();var at=text.indexOf(quote);
    if(at<0)return null;
    var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null);
    var seen=0,node;
    while(node=walker.nextNode()){
      var chunk=node.data.replace(/\s+/g,' ');
      if(seen+chunk.length>=at){
        var r=document.createRange();
        try{r.setStart(node,Math.max(0,Math.min(at-seen,node.data.length)));r.setEnd(node,node.data.length);return r}catch(e){return null}
      }
      seen+=chunk.length;
    }
    return null;
  }
  window.addEventListener('message',function(e){
    if(e.origin!==PARENT_ORIGIN)return;
    if(!e.data||e.data.source!=='docuvault-annotations')return;
    if(e.data.type==='render-markers'){
      Object.values(markers).forEach(function(m){m.remove()});markers={};
      var d=document.getElementById('__dv_placement');if(d)d.remove();
      (e.data.annotations||[]).forEach(function(a){
        var el=null,rect=null;
        if(a.elementId){el=document.getElementById(a.elementId)}
        if(!el&&a.selector){try{el=document.querySelector(a.selector)}catch(ex){}}
        // Quote before selector path: a nth-of-type path matches whatever now
        // occupies that slot, which is how comments end up on the wrong text.
        if(!el&&a.quote){var qr=findQuote(a.quote);if(qr){var qb=qr.getBoundingClientRect();if(qb.width||qb.height)rect=qb}}
        var pin=document.createElement('div');pin.className='dv-pin'+(a.resolved?' resolved':'')+(a.shifted?' shifted':'');
        if(!rect&&el)rect=el.getBoundingClientRect();
        if(rect){
          // rect is viewport-relative; add scroll to get document-absolute
          pin.style.left=(rect.left+window.scrollX+rect.width*(a.offsetX||0)/100)+'px';
          pin.style.top=(rect.top+window.scrollY+rect.height*(a.offsetY||0)/100)+'px';
        }else{
          // Fallback: stored percentages against the full scrollable body
          pin.style.left=(a.xPercent/100*document.documentElement.scrollWidth)+'px';
          pin.style.top=(a.yPercent/100*document.documentElement.scrollHeight)+'px';
        }
        var num=document.createElement('span');num.className='dv-pin-num';num.textContent=a.index;
        pin.appendChild(num);
        pin.addEventListener('click',function(ev){ev.stopPropagation();
          post({source:'docuvault-annotations',type:'marker-click',id:a.id})});
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
        var ax=ev.clientX+window.scrollX,ay=ev.clientY+window.scrollY;
        var xP=(ax/sw)*100,yP=(ay/sh)*100;
        var anchorEl=ev.target.closest('[id]')||ev.target;
        var er=anchorEl.getBoundingClientRect();
        var oX=er.width>0?((ev.clientX-er.left)/er.width)*100:0;
        var oY=er.height>0?((ev.clientY-er.top)/er.height)*100:0;
        // The text of the block that was clicked, so the comment survives a
        // rewrite of the surrounding markup.
        var block=ev.target.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,figcaption,section,article,div')||ev.target;
        var quote=((block.innerText||block.textContent||'').replace(/\s+/g,' ').trim()).slice(0,300)||null;
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
        post({source:'docuvault-annotations',type:'click-position',
          xPercent:xP,yPercent:yP,offsetX:oX,offsetY:oY,
          clientX:ev.clientX,clientY:ev.clientY,quote:quote,
          elementId:anchorEl.id||null,selector:sel});
      });
    }
  });
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){post({source:'docuvault-annotations',type:'ready'})})}
  else{post({source:'docuvault-annotations',type:'ready'})}
})();
</script>"""
}
