#!/usr/bin/env node
/**
 * dsh-motion-complete —— DeepSeek Harness 完整动效主题包（安装 / 卸载 / 检查）
 *
 * 用法：
 *   node bin/apply.mjs                安装（校验 → 应用；幂等：已安装则跳过）
 *   node bin/apply.mjs --revert       卸载（完整还原到原版；未安装则跳过）
 *   node bin/apply.mjs --check        仅检查状态，不写任何文件
 *   node bin/apply.mjs --dry-run      安装/卸载的完整校验但只读不写
 *   node bin/apply.mjs --target <dir> 指定 DSH 安装根目录（默认为自动探测）
 *
 * 安全模型（任何一项不满足都会明确报错并中止，绝不静默失效、绝不写坏文件）：
 *   1. DSH 版本校验：<target>/package.json 的 version 必须等于 manifest 锁定的版本；
 *   2. 包版本校验：每个目标包 package.json 的 version 必须等于锁定版本；
 *   3. 文件 hash 校验：目标文件必须是「已知原版」或「已知已安装」之一，否则视为被
 *      第三方修改，拒绝触碰；
 *   4. 锚点计数校验：每个替换锚点在目标文本中必须恰好出现 1 次；
 *   5. 两阶段提交：先完成全部校验，再统一写盘（任一失败则不写任何文件）；
 *   6. 应用后复核：写盘前对「应用后的完整文本」计算 hash，必须等于已知已安装 hash。
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = join(PROJECT_ROOT, "patches", "manifest.json");

const args = process.argv.slice(2);
const REVERT = args.includes("--revert");
const CHECK = args.includes("--check");
const DRY_RUN = args.includes("--dry-run");
const targetIdx = args.indexOf("--target");
const TARGET = targetIdx >= 0 ? args[targetIdx + 1] : undefined;

const usage = `dsh-motion-complete ${readPackageVersion()} — apply | revert | check

  安装:  node bin/apply.mjs [--target <dshRoot>]
  卸载:  node bin/apply.mjs --revert [--target <dshRoot>]
  检查:  node bin/apply.mjs --check [--target <dshRoot>]
  演练:  node bin/apply.mjs --dry-run [--target <dshRoot>]

  --target 显式指定 DSH 安装根（含 package.json 的 @deepseek-ai/dsh 目录）；
  未指定时自动探测：从当前目录逐级向上查找 node_modules/@deepseek-ai/dsh。`;

function readPackageVersion() {
  try {
    return JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")).version ?? "?";
  } catch {
    return "?";
  }
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path, "utf8"));
}

/** Locate the DSH install root (the directory whose package.json name is @deepseek-ai/dsh). */
function locateDshRoot() {
  if (TARGET !== undefined) {
    const p = resolve(TARGET);
    const pkg = join(p, "package.json");
    if (!existsSync(pkg)) throw new Error(`--target 目录不存在或缺少 package.json: ${p}`);
    const name = JSON.parse(readFileSync(pkg, "utf8")).name;
    if (name !== "@deepseek-ai/dsh") {
      throw new Error(`--target 不是 @deepseek-ai/dsh 安装根（package.json name = ${name}）: ${p}`);
    }
    return p;
  }
  let dir = process.cwd();
  for (;;) {
    const pkg = join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json");
    if (existsSync(pkg)) {
      const name = JSON.parse(readFileSync(pkg, "utf8")).name;
      if (name === "@deepseek-ai/dsh") return join(dir, "node_modules", "@deepseek-ai", "dsh");
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "未找到 DSH 安装（向上查找 node_modules/@deepseek-ai/dsh 无果）。请用 --target 显式指定，例如：\n" +
      "  node bin/apply.mjs --target \"C:\\Users\\<用户>\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\""
  );
}

/** Read a JSON file, fail loudly on syntax errors. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 JSON 文件 ${path}: ${error.message}`);
  }
}

function atomicWrite(path, content) {
  const tmp = `${path}.dsh-motion-complete.tmp`;
  writeFileSync(tmp, content, "utf8");
  try {
    renameSync(tmp, path);
  } catch (error) {
    // Windows: rename 覆盖偶尔被占用，兜底直接写
    try {
      writeFileSync(path, content, "utf8");
    } catch (inner) {
      throw new Error(`写入 ${path} 失败: ${inner.message}`);
    }
  }
}

function verifyDshVersion(dshRoot, manifest) {
  const pkg = readJson(join(dshRoot, "package.json"));
  const actual = pkg.version;
  const supported = manifest.versions.map((v) => v.dshVersion).join(", ");
  const entry = manifest.versions.find((v) => v.dshVersion === actual);
  if (!entry) {
    throw new Error(
      `DSH 版本不匹配，已中止（绝不写文件）。\n` +
        `  当前安装版本:   ${actual}\n` +
        `  主题包支持版本: ${supported}\n` +
        `安装位置: ${dshRoot}\n` +
        `请安装受支持的 DSH 版本，或等待 dsh-motion-complete 发布适配新版本的补丁包。`
    );
  }
  return entry;
}

function verifyPackageVersion(pkgDir, manifest, target) {
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) throw new Error(`缺少包清单 ${pkgPath}`);
  const pkg = readJson(pkgPath);
  if (pkg.version !== target.packageVersion) {
    throw new Error(
      `目标包版本不匹配，已中止。\n` +
        `  包: ${target.package} (${target.dir})\n` +
        `  主题包锁定版本: ${target.packageVersion}\n` +
        `  实际安装版本:   ${pkg.version}`
    );
  }
}

function applyEdits(text, edits, direction, fileLabel) {
  // direction: "forward" (original → patched) or "reverse" (patched → original)
  const list = direction === "forward" ? edits : [...edits].reverse();
  let out = text;
  for (const [index, edit] of list.entries()) {
    const from = direction === "forward" ? edit.old : edit.new;
    const to = direction === "forward" ? edit.new : edit.old;
    let count = 0;
    let at = -1;
    for (let pos = 0; (pos = out.indexOf(from, pos)) !== -1; pos += from.length) {
      count++;
      at = pos;
    }
    if (count !== 1) {
      throw new Error(
        `锚点校验失败，已中止。\n` +
          `  文件: ${fileLabel}\n` +
          `  锚点 #${index + 1}/${list.length}（${direction === "forward" ? "old" : "new"}）匹配 ${count} 次（必须恰好 1 次）\n` +
          `  锚点预览: ${from.slice(0, 120)}${from.length > 120 ? "…" : ""}\n` +
          `可能原因：DSH 文件已被其他工具修改、或主题包版本与安装不匹配。`
      );
    }
    out = out.slice(0, at) + to + out.slice(at + from.length);
  }
  return out;
}

function stateOf(actualHash, target) {
  if (actualHash === target.sha256.original) return "original";
  if (actualHash === target.sha256.patched) return "patched";
  return "unknown";
}

function main() {
  console.log(`dsh-motion-complete ${readPackageVersion()} — ${REVERT ? "卸载 (--revert)" : CHECK ? "检查 (--check)" : DRY_RUN ? "演练 (--dry-run)" : "安装"}`);
  const manifest = readJson(MANIFEST_PATH);
  if (!manifest || !Array.isArray(manifest.versions) || manifest.versions.length === 0) {
    throw new Error(`清单无效（缺少 versions）: ${MANIFEST_PATH}`);
  }
  const dshRoot = locateDshRoot();
  const dshPkgRoot = dshRoot; // <dshRoot>/package.json belongs to @deepseek-ai/dsh
  const versionEntry = verifyDshVersion(dshRoot, manifest);
  const targets = versionEntry.targets;
  console.log(`DSH 安装: ${dshRoot}（版本 ${versionEntry.dshVersion} ✓，支持: ${manifest.versions.map((v) => v.dshVersion).join(" / ")}）`);

  // ---- phase 1: validate everything, decide per-file action ----
  const plans = [];
  for (const target of targets) {
    const pkgDir = join(dshPkgRoot, "node_modules", "@deepseek-ai", target.dir);
    verifyPackageVersion(pkgDir, manifest, target);
    const filePath = join(pkgDir, target.rel);
    if (!existsSync(filePath)) throw new Error(`缺少目标文件: ${filePath}`);
    const actualHash = sha256File(filePath);
    const state = stateOf(actualHash, target);
    const label = `${target.dir}/${target.rel}`;
    if (REVERT) {
      if (state === "original") {
        plans.push({ target, filePath, label, action: "skip", note: "已是原版（未安装）" });
      } else if (state === "patched") {
        if (CHECK || DRY_RUN) {
          plans.push({ target, filePath, label, action: "would-revert", note: "待还原" });
        } else {
          const reverted = applyEdits(readFileSync(filePath, "utf8"), target.edits, "reverse", label);
          const revertedHash = sha256(reverted);
          if (revertedHash !== target.sha256.original) {
            throw new Error(`还原后复核失败，已中止。文件: ${label}（期望 ${target.sha256.original}，实际 ${revertedHash}）`);
          }
          plans.push({ target, filePath, label, action: "revert", note: "", content: reverted });
        }
      } else {
        throw new Error(
          `文件状态未知（既非原版也非本主题包安装态），拒绝触碰，已中止。\n` +
            `  文件: ${label}\n  实际 hash: ${actualHash}\n` +
            `请先恢复该文件（如重新安装对应 DSH 包）后再执行。`
        );
      }
    } else {
      // install
      if (state === "patched") {
        plans.push({ target, filePath, label, action: "skip", note: "已安装（幂等跳过）" });
      } else if (state === "original") {
        if (CHECK || DRY_RUN) {
          plans.push({ target, filePath, label, action: "would-apply", note: "待安装" });
        } else {
          const patched = applyEdits(readFileSync(filePath, "utf8"), target.edits, "forward", label);
          const patchedHash = sha256(patched);
          if (patchedHash !== target.sha256.patched) {
            throw new Error(`应用后复核失败，已中止。文件: ${label}（期望 ${target.sha256.patched}，实际 ${patchedHash}）`);
          }
          plans.push({ target, filePath, label, action: "apply", note: "", content: patched });
        }
      } else {
        throw new Error(
          `文件状态未知（既非原版也非本主题包安装态），拒绝触碰，已中止。\n` +
            `  文件: ${label}\n  实际 hash: ${actualHash}\n` +
            `可能已安装过其他版本的主题包或手动改过文件，请先恢复原版。`
        );
      }
    }
  }

  // ---- phase 2: write (only after every file validated) ----
  // 写盘阶段不输出任何日志：stdout 管道被提前关闭（EPIPE）时写盘循环不能中断，
  // 否则会留下半补丁状态。所有文件写完后才统一报告。
  const summary = { apply: 0, revert: 0, skip: 0, would: 0 };
  for (const plan of plans) {
    if (plan.action === "apply" || plan.action === "revert") {
      atomicWrite(plan.filePath, plan.content);
      summary[plan.action]++;
    } else if (plan.action === "skip") {
      summary.skip++;
    } else {
      summary.would++;
    }
  }

  const report = (line) => {
    try {
      console.log(line);
    } catch (error) {
      // EPIPE 等输出中断不影响结果（写盘已完成）
    }
  };
  for (const plan of plans) {
    if (plan.action === "apply" || plan.action === "revert") {
      report(`  ✓ ${plan.action === "apply" ? "已安装" : "已还原"}  ${plan.label}`);
    } else if (plan.action === "skip") {
      report(`  - 跳过（${plan.note}）  ${plan.label}`);
    } else {
      report(`  · ${plan.note}  ${plan.label}（未写盘）`);
    }
  }

  report("");
  if (CHECK) {
    report(`检查完成：${plans.length} 个目标全部可校验 ✓（本次未写任何文件）`);
  } else if (DRY_RUN) {
    report(`演练完成：${plans.length} 个目标全部通过校验 ✓（本次未写任何文件）`);
  } else if (REVERT) {
    if (summary.revert > 0) {
      report(`卸载完成：还原 ${summary.revert} 个文件，跳过 ${summary.skip} 个。`);
      report("提示：如 Web 页面正在运行，请刷新页面（必要时强刷 Ctrl+Shift+R）以观察还原效果。");
    } else {
      report("没有需要还原的文件（主题包未安装或已还原）。");
    }
  } else {
    if (summary.apply > 0) {
      report(`安装完成：应用 ${summary.apply} 个文件，跳过 ${summary.skip} 个（已安装）。`);
      report("提示：刷新页面（必要时强刷 Ctrl+Shift+R）后全部动效即生效。");
    } else {
      report("没有需要安装的文件（主题包已安装或尚未安装）。");
    }
  }
}

try {
  main();
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
}
