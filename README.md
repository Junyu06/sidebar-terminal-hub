 :rose::rose::rose:  _已上架vscode商店，搜索 `Right Sidebar Terminal` 即可_ 

## 辅助栏命令行管理工具

一个把**可交互命令行**直接放进 VS Code 辅助侧边栏的扩展。

现在不是“点按钮再打开原生命令行标签”，而是**在侧边栏里直接显示终端窗口**，可以直接输入并运行 `codex`、`opencode` 等 CLI 命令。

![Right Sidebar Terminal screenshot](https://gitee.com/wagio_admin/vscode-right-sidebar-terminal/raw/main/media/readme_image_1.png)

## 功能特性

- 在辅助侧边栏中直接显示可交互终端
- 支持多个终端会话标签
- 支持直接键盘输入、粘贴、运行命令
- 支持 ANSI / TUI 类终端输出
- 支持状态栏 `Terminal` 按钮一键打开
- 支持在视图标题栏中新建 / 关闭当前终端

## 使用方式

- 点击状态栏中的 `Terminal`
- 点击 `+` 新建多个终端标签
- 点击 `×` 关闭当前终端标签

## 适用场景

适合希望把命令行长期放在右侧侧边栏中的工作流，例如：

- 运行 `codex`、`opencode`
- 同时保留多个 CLI 会话

## 开发

```bash
npm install
npm run compile
```

然后在 VS Code 中按 `F5` 启动扩展开发宿主窗口。

## 打包

```bash
npm.cmd run package:patch
```

这个命令会自动：

- 补丁版本号 `+1`
- 编译扩展
- 生成新的 `.vsix`

## License

MIT
