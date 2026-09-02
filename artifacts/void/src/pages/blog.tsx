import { Link, useRoute } from "wouter";
import { PageHero } from "@/components/site/page-hero";
import { Icon, Reveal, RevealGroup, RevealItem } from "@/components/site/primitives";
import { CodeBlock } from "@/sections/install";
import { posts } from "@/lib/site-data";
import { usePageMeta } from "@/lib/use-site";

export function BlogIndex() {
  usePageMeta(
    "Blog, VOID",
    "Notes on agent side effects, reversibility classes and record keeping for autonomous systems.",
    "/blog",
  );

  return (
    <>
      <PageHero
        kicker="BLOG / 14"
        title="Notes on agent side effects."
        copy="Longer arguments that did not fit on the homepage. Architecture, classification and the record keeping duty, written for people who ship agents."
        meta={[`${posts.length} posts`, "no newsletter", "written by the team"]}
      />

      <div style={{ padding: "clamp(30px, 5vw, 56px) var(--gut)" }}>
        <RevealGroup className="post-grid" stagger={0.07}>
          {posts.map((post) => (
            <RevealItem key={post.slug} style={{ height: "100%" }}>
              <Link href={`/blog/${post.slug}`} data-testid={`link-post-${post.slug}`}>
                <article className="post-card">
                  <div className="post-meta">
                    <span className="tag tag-accent">{post.tag}</span>
                    <span>{post.date}</span>
                    <span>{post.read}</span>
                  </div>
                  <h3 className="h3">{post.title}</h3>
                  <p>{post.excerpt}</p>
                  <span className="link-arrow">
                    Read
                    <Icon name="arrowUpRight" size={14} />
                  </span>
                </article>
              </Link>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </>
  );
}

export function BlogPost() {
  const [, params] = useRoute("/blog/:slug");
  const post = posts.find((entry) => entry.slug === params?.slug);

  usePageMeta(
    post ? `${post.title}, VOID blog` : "Post not found, VOID",
    post?.excerpt ?? "This post does not exist.",
    post ? `/blog/${post.slug}` : "/blog",
  );

  if (!post) {
    return (
      <div className="not-found">
        <div>
          <h1 className="h2">This post is not in the ledger.</h1>
          <Link href="/blog" className="btn btn-primary mt-md" data-testid="link-blog-back">
            Back to the blog
          </Link>
        </div>
      </div>
    );
  }

  const index = posts.indexOf(post);
  const next = posts[(index + 1) % posts.length];

  return (
    <>
      <PageHero
        kicker={`BLOG / ${post.tag.toUpperCase()}`}
        title={post.title}
        copy={post.excerpt}
        meta={[post.date, post.read, post.tag]}
      />

      <div className="doc-layout" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Reveal>
          <article className="prose" style={{ margin: "0 auto" }}>
            {post.body.map((block, blockIndex) => {
              if (block.h) return <h2 key={blockIndex}>{block.h}</h2>;
              if (block.code)
                return (
                  <div key={blockIndex} style={{ margin: "18px 0" }}>
                    <CodeBlock code={block.code} label="example" />
                  </div>
                );
              if (block.list)
                return (
                  <ul key={blockIndex}>
                    {block.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                );
              if (block.quote) return <blockquote key={blockIndex}>{block.quote}</blockquote>;
              return <p key={blockIndex}>{block.p}</p>;
            })}

            <hr />
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Link href="/blog" className="link-arrow" data-testid="link-blog-index">
                All posts
              </Link>
              <Link href={`/blog/${next.slug}`} className="btn btn-ghost btn-sm" data-testid="link-blog-next">
                Next: {next.title}
                <Icon name="arrow" size={14} />
              </Link>
            </div>
          </article>
        </Reveal>
      </div>
    </>
  );
}
